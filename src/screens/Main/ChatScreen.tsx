import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  type AppStateStatus,
  FlatList,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Button, Icon, Screen, SyncBanner, confirmAlert, showAlert, showSheet, showToast } from '@/components/common';
import { AttachMenu, type AttachKind } from '@/components/chat/AttachMenu';
import { ChatMenuSheet, type ChatMenuAction } from '@/components/chat/ChatMenuSheet';
import { EmojiSheet } from '@/components/chat/EmojiSheet';
import { EncryptionInfoModal } from '@/components/chat/EncryptionInfoModal';
import { MessageActionSheet } from '@/components/chat/MessageActionSheet';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { PinnedBanner } from '@/components/chat/PinnedBanner';
import { QuickReplies } from '@/components/chat/QuickReplies';
import { selectContacts } from '@/screens/Main/SelectContactsScreen';
import { useMediaPicker, type LocalMediaFile } from '@/hooks/useMediaPicker';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useChatPrefs } from '@/context/ChatPrefsContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { onLocalMessageEvent } from '@/context/MessageSync';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { ApiError } from '@/api';
import { messageRepo } from '@/db/repositories/messageRepo';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import type { MainScreenProps } from '@/navigation/types';
import {
  conversationService,
  messageService,
  pendingMediaService,
  userService,
} from '@/services';
import { mediaCache } from '@/services/mediaCache';
import { messageService as netMessageService } from '@/services/messageService.net';
import { getVoiceState, subscribeVoice, toggleVoice } from '@/services/voicePlayer';
import { retryFailedDecryptions, syncNow } from '@/sync/syncEngine';
import type { ChatMessage, MessageType, PinDuration, PinnedMessage, RequestStatus } from '@/types';
import { callStartErrorMessage } from '@/utils/callError';
import { E2EE_ENABLED } from '@/utils/constants';
import { dayLabel, lastSeenLabel } from '@/utils/time';
import { mediaUrl } from '@/utils/media';

type Item =
  | { kind: 'msg'; m: LocalMessage }
  | { kind: 'day'; label: string; key: string }
  | { kind: 'unread'; count: number; key: string };

const INITIAL_PAGE_SIZE = 60;
const OLDER_PAGE_SIZE = 40;

/**
 * Construit la liste affichée (inversée : plus récent en premier) avec les
 * séparateurs de jour et, si `unreadCount > 0`, une barre « X messages non lus »
 * insérée JUSTE au-dessus du premier message non lu — c.-à-d. avant le plus
 * ancien des `unreadCount` derniers messages reçus (non envoyés par moi).
 */
function withDaySeparators(
  messages: LocalMessage[],
  unreadCount: number,
  myId: string,
): Item[] {
  // id du 1er message non lu = le plus ancien des `unreadCount` messages reçus
  let firstUnreadId: string | null = null;
  if (unreadCount > 0) {
    let seen = 0;
    for (const m of messages) {
      // liste déjà triée du + récent au + ancien
      if (m.sender_id === myId) continue;
      seen += 1;
      firstUnreadId = m.id;
      if (seen >= unreadCount) break;
    }
  }

  const out: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    out.push({ kind: 'msg', m });
    if (m.id === firstUnreadId) {
      // barre APRÈS le message dans la liste inversée = visuellement AU-DESSUS
      out.push({ kind: 'unread', count: unreadCount, key: `unread-${m.id}` });
    }
    const next = messages[i + 1];
    if (!next || new Date(m.created_at).toDateString() !== new Date(next.created_at).toDateString()) {
      out.push({ kind: 'day', label: dayLabel(m.created_at), key: `day-${m.id}` });
    }
  }
  return out;
}

export const ChatScreen: React.FC<MainScreenProps<'Chat'>> = ({ route, navigation }) => {
  const { conversationId, partnerId, partnerName, partnerAvatar, jumpToMessageId, jumpToCreatedAt } =
    route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const { addListener, sendTyping } = useWs();
  const { online } = useSync();
  const { wallpaper, enterToSend } = useChatPrefs();
  const { available: callsAvailable, startCall, phase: callPhase } = useCall();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  // nombre de messages non lus à l'ouverture — figé pour la durée de l'écran,
  // sert à positionner la barre « X messages non lus » (façon WhatsApp).
  const [unreadAtOpen, setUnreadAtOpen] = useState(0);
  const unreadCaptured = useRef(false);
  const [loading, setLoading] = useState(true);
  // Scroll infini (historique plus ancien) : `loadedCount` est le nombre de
  // messages que `reload()` doit redemander au local pour ne PAS faire
  // "reculer" la liste jusqu'en haut à chaque rechargement déclenché par un
  // événement temps réel pendant qu'on a déjà chargé plus ancien.
  const loadedCountRef = useRef(INITIAL_PAGE_SIZE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const loadingOlderRef = useRef(false);
  // épuisement du LOCAL (SQLite) — une fois vrai, `loadOlder` tente le réseau.
  const localExhaustedRef = useRef(false);
  // épuisement du RÉSEAU (serveur) — plus rien à charger nulle part.
  const [hasMoreRemote, setHasMoreRemote] = useState(true);
  const netPageRef = useRef(1); // prochaine page serveur à demander (offset-based)
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  // Demande entrante : la zone de saisie est remplacée par une bannière
  // Accepter/Refuser/Bloquer (voir plus bas) — `ensureAccepted` reste un
  // filet de sécurité pour les canaux d'envoi qui ne passent pas par cette
  // bannière (répondre à une citation, renvoyer un message échoué, etc.).
  // Le ref est la source utilisée par ce chemin (pas de dépendance de
  // re-render), le state ne sert qu'à piloter l'affichage de la bannière.
  const requestStatusRef = useRef<RequestStatus>('accepted');
  const [requestStatusUi, setRequestStatusUi] = useState<RequestStatus>('accepted');
  const setRequestStatus = useCallback((v: RequestStatus) => {
    requestStatusRef.current = v;
    setRequestStatusUi(v);
  }, []);
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [partnerActivity, setPartnerActivity] = useState<'text' | 'audio'>('text');
  const [attachOpen, setAttachOpen] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  // Vue unique (façon WhatsApp) : armée juste avant l'envoi réel d'un vocal
  // (bouton "1" dans la barre verrouillée, à côté d'Envoyer) — jamais avant
  // l'enregistrement, l'utilisateur ne sait pas encore ce qu'il envoie.
  const [voiceViewOnce, setVoiceViewOnce] = useState(false);
  // Fichier en attente de confirmation ("Envoyer ce fichier ?") — permet d'y
  // proposer le même bouton "1" juste avant l'envoi, comme pour le vocal.
  const [pendingFile, setPendingFile] = useState<LocalMediaFile | null>(null);
  const [fileViewOnce, setFileViewOnce] = useState(false);
  const picker = useMediaPicker();
  // message en cours d'édition (null = mode envoi normal)
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [actionMsg, setActionMsg] = useState<LocalMessage | null>(null);
  const [pinnedMessages, setPinnedMessages] = useState<PinnedMessage[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [encOpen, setEncOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const partnerTypingTtl = useRef<ReturnType<typeof setTimeout> | null>(null);
  // "jump to message" depuis l'écran de recherche — ref pour scroller
  // jusqu'à l'index cible, id surligné brièvement le temps de le repérer.
  const listRef = useRef<FlatList<Item>>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const highlightTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // évite de rejouer le jump à chaque re-render tant que la cible n'a pas
  // changé (ex: reload() déclenché par un événement temps réel pendant qu'on
  // vient d'atterrir ici depuis la recherche).
  const jumpedToRef = useRef<string | null>(null);

  const myId = me?.id ?? '';
  // calculé tôt (avant les effets de "jump to message" ci-dessous, qui en
  // dépendent pour repérer l'index du message ciblé) plutôt qu'en fin de
  // composant — `withDaySeparators` est peu coûteux (une seule passe).
  const items = useMemo(
    () => withDaySeparators(messages, unreadAtOpen, myId),
    [messages, unreadAtOpen, myId],
  );

  const reload = useCallback(async () => {
    const [page, conv] = await Promise.all([
      messageService.page(conversationId, loadedCountRef.current),
      conversationRepo.get(conversationId),
    ]);
    setMessages(page);
    // le local peut avoir reçu de nouvelles lignes depuis le dernier
    // `loadOlder` (sync, temps réel) : si la page redemandée revient pleine,
    // le local n'est provisoirement plus considéré comme épuisé.
    if (page.length >= loadedCountRef.current) localExhaustedRef.current = false;
    if (conv) {
      setRequestStatus(conv.request_status);
      setPartnerOnline(conv.partner.is_online);
      // capture unique : après le 1er reload, markRead a déjà remis le compteur
      // à 0, donc on ne le relit plus.
      if (!unreadCaptured.current) {
        unreadCaptured.current = true;
        setUnreadAtOpen(conv.unread_count > 0 ? conv.unread_count : 0);
      }
    } else if (!unreadCaptured.current) {
      unreadCaptured.current = true;
    }
    setLoading(false);
  }, [conversationId, setRequestStatus]);

  // rafraîchit le détail serveur (statut de demande, présence) à l'ouverture —
  // best-effort, l'affichage local reste la source si hors-ligne.
  const refreshDetail = useCallback(async () => {
    try {
      const [d, blk] = await Promise.all([
        conversationService.detail(conversationId),
        userService.blockedUsers().catch(() => []),
      ]);
      setRequestStatus(d.request_status);
      setPartnerOnline(d.partner.is_online);
      setPartnerLastSeen(d.partner.last_seen_at ?? null);
      setMuted(d.muted);
      setBlocked(blk.some((u) => u.id === partnerId));
    } catch {
      /* hors-ligne — on garde le cache local */
    }
  }, [conversationId, partnerId, setRequestStatus]);

  /**
   * Scroll infini vers le haut (liste inversée -> `onEndReached`) : charge des
   * messages plus anciens que ceux déjà affichés.
   *
   * Stratégie : d'abord le LOCAL (instantané, hors-ligne OK — la page SQLite
   * grandit simplement via `loadedCountRef`). Si le local ne renvoie pas une
   * page pleine, il est épuisé pour l'instant -> on tente le RÉSEAU (pages
   * offset-based de `GET /conversations/{id}/messages`), on déchiffre/upsert
   * chaque message reçu comme le fait `pullDeltas` (pour qu'il persiste en
   * local et ne soit plus jamais re-téléchargé), puis on relit le local avec
   * le nouveau total — ce qui remonte à `reload()` la fusion + le tri déjà
   * gérés par la requête SQL.
   */
  const loadOlder = useCallback(async () => {
    if (loadingOlderRef.current || messages.length === 0) return;
    loadingOlderRef.current = true;
    setLoadingOlder(true);
    try {
      if (!localExhaustedRef.current) {
        const wanted = loadedCountRef.current + OLDER_PAGE_SIZE;
        const page = await messageService.page(conversationId, wanted);
        const grew = page.length > loadedCountRef.current;
        if (grew) {
          loadedCountRef.current = page.length;
          setMessages(page);
        }
        // page.length < wanted -> le local a rendu tout ce qu'il avait, il est
        // épuisé pour l'instant (que cette passe ait ou non trouvé du neuf) —
        // le prochain `loadOlder` ira directement au réseau. On aligne alors
        // le curseur réseau sur ce qui est déjà chargé (même taille de page
        // que le réseau, `OLDER_PAGE_SIZE`) pour éviter de re-télécharger des
        // messages déjà connus — un léger chevauchement reste possible si le
        // total chargé n'est pas un multiple exact de `OLDER_PAGE_SIZE`
        // (page initiale de 60), sans risque de doublon grâce à l'upsert
        // idempotent par id.
        if (page.length < wanted) {
          localExhaustedRef.current = true;
          netPageRef.current = Math.max(
            1,
            Math.floor(page.length / OLDER_PAGE_SIZE) + 1,
          );
        }
        if (grew) return;
      }
      if (!hasMoreRemote || !online) return;
      const netPage = netPageRef.current;
      const raw = await netMessageService.history(conversationId, netPage, OLDER_PAGE_SIZE);
      netPageRef.current = netPage + 1;
      if (raw.length === 0) {
        setHasMoreRemote(false);
        return;
      }
      for (const m of raw) {
        if (m.sender_id === myId) {
          const local = await messageRepo.getById(m.id);
          await messageRepo.upsertFromServer(m, {
            mine: true,
            plainBody: local?.body ?? (m.encrypted ? '' : m.body),
          });
        } else {
          const decrypted = await netMessageService.decryptIfNeeded(m);
          await messageRepo.upsertFromServer(decrypted, {
            decryptFailed: !!decrypted.decryptFailed,
            cipherBody: decrypted.decryptFailed && m.encrypted ? m.body : null,
          });
        }
      }
      if (raw.length < OLDER_PAGE_SIZE) setHasMoreRemote(false);
      // le réseau a bien ecrit en local -> une nouvelle page locale les inclut
      localExhaustedRef.current = false;
      const wanted = loadedCountRef.current + raw.length;
      const page = await messageService.page(conversationId, wanted);
      loadedCountRef.current = wanted;
      setMessages(page);
    } catch (e) {
      console.warn('[ChatScreen] loadOlder failed:', e);
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlder(false);
    }
  }, [conversationId, messages.length, myId, hasMoreRemote, online]);

  const reloadPinned = useCallback(() => {
    void conversationService
      .listPinned(conversationId)
      .then(setPinnedMessages)
      .catch(() => undefined);
  }, [conversationId]);

  useEffect(() => {
    // nouvelle conversation ouverte -> pagination repartie de zéro
    loadedCountRef.current = INITIAL_PAGE_SIZE;
    localExhaustedRef.current = false;
    netPageRef.current = 1;
    setHasMoreRemote(true);
    // 1) on lit d'abord le compteur non-lus + les messages, PUIS on marque lu
    //    (sinon markRead remet le compteur à 0 avant qu'on l'ait capturé).
    void reload().then(() => {
      void messageService.markRead(conversationId, myId);
    });
    void refreshDetail();
    reloadPinned();
    // filet : messages "pending" restés sans entrée d'outbox (app tuée) -> ré-empile
    void messageService.recoverOrphanPending(myId).then((n) => {
      if (n > 0) void reload();
    });
    // re-tente le déchiffrement des messages restés chiffrés, puis rafraîchit
    void retryFailedDecryptions().then((n) => {
      if (n > 0) void reload();
    });
    void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  /**
   * "Jump to message" depuis l'écran de recherche : on ne connaît pas
   * l'INDEX du message ciblé dans la page locale déjà chargée (il peut être
   * bien plus ancien que `INITIAL_PAGE_SIZE`). Stratégie robuste : compter
   * combien de messages locaux sont "plus récents ou égaux" à sa date
   * (`countAtOrNewer`), puis redemander une page au moins aussi grande
   * (+marge) — le message cible est alors garanti présent dans `messages`,
   * sans avoir à deviner une pagination par offset.
   */
  useEffect(() => {
    if (!jumpToMessageId) return;
    if (jumpedToRef.current === jumpToMessageId) return; // déjà traité
    let cancelled = false;
    void (async () => {
      try {
        const wanted = jumpToCreatedAt
          ? (await messageRepo.countAtOrNewer(conversationId, jumpToCreatedAt)) + 20
          : loadedCountRef.current;
        if (wanted > loadedCountRef.current) {
          loadedCountRef.current = wanted;
          const page = await messageService.page(conversationId, wanted);
          if (cancelled) return;
          setMessages(page);
        }
      } catch (e) {
        console.warn('[ChatScreen] jump-to-message load failed:', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [jumpToMessageId, jumpToCreatedAt, conversationId]);

  // une fois la page (re)chargée assez grande, `items` contient (si trouvé)
  // le message ciblé -> on scrolle jusqu'à lui et on le surligne brièvement.
  useEffect(() => {
    if (!jumpToMessageId || jumpedToRef.current === jumpToMessageId) return;
    const idx = items.findIndex((it) => it.kind === 'msg' && it.m.id === jumpToMessageId);
    if (idx === -1) return; // pas encore chargé (l'effet ci-dessus tourne peut-être encore)
    jumpedToRef.current = jumpToMessageId;
    // léger délai : laisse le temps à la FlatList de rendre la page qui vient
    // de grandir avant de lui demander de scroller dedans.
    const id = setTimeout(() => {
      listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.5 });
    }, 60);
    setHighlightedMessageId(jumpToMessageId);
    if (highlightTimeout.current) clearTimeout(highlightTimeout.current);
    highlightTimeout.current = setTimeout(() => setHighlightedMessageId(null), 1800);
    return () => clearTimeout(id);
  }, [items, jumpToMessageId]);

  // message très ancien jamais synchronisé localement -> `countAtOrNewer` a
  // pu renvoyer un compte qui ne le couvre pas (ex: il vient d'un autre
  // appareil et n'a pas encore atteint ce téléphone) : on prévient plutôt
  // que de laisser l'utilisateur face à une liste qui ne bouge jamais.
  useEffect(() => {
    if (!jumpToMessageId || loading) return;
    if (jumpedToRef.current === jumpToMessageId) return;
    const found = items.some((it) => it.kind === 'msg' && it.m.id === jumpToMessageId);
    if (found) return;
    const id = setTimeout(() => {
      if (jumpedToRef.current !== jumpToMessageId) {
        jumpedToRef.current = jumpToMessageId; // n'affiche l'erreur qu'une fois
        showToast(t('chat.jumpToMessageFailed'), { type: 'error' });
      }
    }, 2500);
    return () => clearTimeout(id);
  }, [items, jumpToMessageId, loading, t]);

  // le message entrant est ingéré globalement par <MessageSync/> ; ici on se
  // contente de recharger la liste quand un message de CETTE conv est arrivé.
  useEffect(() => {
    return onLocalMessageEvent((ev) => {
      if (ev.type === 'message' && ev.conversationId === conversationId) {
        void reload();
        // markRead seulement pour un message REÇU (pas pour la confirmation
        // d'un de nos propres envois).
        if (ev.incoming) void messageService.markRead(conversationId, myId);
      }
    });
  }, [conversationId, myId, reload]);

  useEffect(() => {
    const off = addListener((e: WsEvent) => {
      if (e.type === 'message.deleted' && e.conversation_id === conversationId) {
        void messageRepo.markDeleted(e.message_id as string).then(reload);
      } else if (e.type === 'message.view_once_opened' && e.conversation_id === conversationId) {
        // le destinataire vient d'ouvrir ma pièce jointe vue-unique — le
        // fichier n'existe plus côté serveur, bulle grisée chez moi aussi.
        void messageRepo.markViewOnceOpened(e.message_id as string).then(reload);
      } else if (e.type === 'message.edited') {
        const em = e.message as ChatMessage | undefined;
        if (em?.conversation_id === conversationId && em.id) {
          void messageRepo
            .applyEdit(em.id, em.encrypted ? '' : em.body)
            .then(reload);
        }
      } else if (e.type === 'message.reaction') {
        void messageRepo.setReaction(e.message_id as string, (e.emoji as string) ?? null).then(reload);
      } else if (
        (e.type === 'message.pinned' || e.type === 'message.unpinned') &&
        e.conversation_id === conversationId
      ) {
        reloadPinned();
      } else if (e.type === 'receipt.read' && e.conversation_id === conversationId) {
        void messageRepo.markMineRead(conversationId, myId).then(reload);
      } else if (e.type === 'receipt.delivered' && e.conversation_id === conversationId) {
        void messageRepo.markMineDelivered(e.message_id as string).then(reload);
      } else if (
        (e.type === 'typing.start' || e.type === 'typing.stop') &&
        e.conversation_id === conversationId &&
        e.user_id === partnerId
      ) {
        const on = e.type === 'typing.start';
        setPartnerTyping(on);
        setPartnerActivity(on && e.activity === 'audio' ? 'audio' : 'text');
        if (partnerTypingTtl.current) clearTimeout(partnerTypingTtl.current);
        if (on) {
          // si le `typing.stop` se perd, on efface au bout de 6 s
          partnerTypingTtl.current = setTimeout(() => setPartnerTyping(false), 6000);
        }
      } else if (e.type === 'message.new' && e.conversation_id === conversationId) {
        setPartnerTyping(false);
        if (partnerTypingTtl.current) clearTimeout(partnerTypingTtl.current);
      } else if (e.type === 'presence.update' && e.user_id === partnerId) {
        const on = !!e.online;
        setPartnerOnline(on);
        if (!on) {
          setPartnerLastSeen(
            typeof e.last_seen_at === 'string' ? e.last_seen_at : new Date().toISOString(),
          );
        }
      } else if (e.type === 'conversation.accepted' && e.user_id === partnerId) {
        // le partenaire a accepte ma demande
        void conversationRepo.setRequestStatus(conversationId, 'accepted').then(() => {
          conversationRepo.markSynced(conversationId);
          setRequestStatus('accepted');
        });
      }
    });
    return () => {
      off();
      if (partnerTypingTtl.current) clearTimeout(partnerTypingTtl.current);
    };
  }, [addListener, conversationId, partnerId, myId, reload, reloadPinned, setRequestStatus]);

  const onChangeText = useCallback(
    (v: string) => {
      setText(v);
      sendTyping(conversationId, 'start');
      if (typingTimeout.current) clearTimeout(typingTimeout.current);
      typingTimeout.current = setTimeout(() => sendTyping(conversationId, 'stop'), 1500);
    },
    [sendTyping, conversationId],
  );

  /** Répondre à une demande de message l'accepte implicitement (comme
   * WhatsApp : pas de barre Accepter/Refuser qui bloque la saisie — écrire
   * suffit). Best-effort, silencieux si hors-ligne (l'outbox rejouera). */
  const ensureAccepted = useCallback(() => {
    if (requestStatusRef.current !== 'pending_incoming') return;
    requestStatusRef.current = 'accepted';
    void conversationService.accept(conversationId).catch(() => undefined);
  }, [conversationId]);

  /** Relance une demande refusée (bouton dans l'alerte affichée par
   * `canSendNow`). Best-effort, silencieux si hors-ligne. */
  const doRetryRequest = useCallback(() => {
    void conversationService
      .retry(conversationId)
      .then(() => {
        requestStatusRef.current = 'pending_outgoing';
        setRequestStatusUi('pending_outgoing');
      })
      .catch(() => showToast(t('errors.generic'), { type: 'error' }));
  }, [conversationId, t]);

  /** Vérifie AVANT d'envoyer (texte, média, vocal…) si la demande de
   * conversation le permet encore — on bloque ici plutôt que de laisser
   * l'outbox échouer en silence en arrière-plan (send() est fire-and-forget,
   * son échec réseau différé n'arriverait jamais à l'utilisateur avec un
   * message clair). Ne s'applique qu'à MOI en tant qu'initiateur : en
   * `pending_incoming` la bannière remplace déjà tout le composer. */
  const canSendNow = useCallback((): boolean => {
    if (requestStatusRef.current === 'declined') {
      showAlert(t('chat.requestDeclinedTitle'), t('chat.requestDeclinedBody', { name: partnerName }), [
        { text: t('common.cancel'), style: 'cancel' },
        { text: t('chat.retryRequest'), onPress: doRetryRequest },
      ]);
      return false;
    }
    if (requestStatusRef.current === 'pending_outgoing') {
      const sentCount = messages.filter((m) => m.sender_id === myId).length;
      if (sentCount >= 3) {
        showAlert(t('chat.requestLimitTitle'), t('chat.requestLimitBody', { name: partnerName }));
        return false;
      }
    }
    return true;
  }, [messages, myId, partnerName, t, doRetryRequest]);

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;
    ensureAccepted();
    if (!editing && !canSendNow()) return;

    // mode édition : on applique la modification au lieu d'un nouvel envoi
    if (editing) {
      const target = editing;
      setEditing(null);
      setText('');
      try {
        await messageService.edit(target.id, body);
        await reload();
        void syncNow({ force: true });
      } catch (e) {
        console.warn('[ChatScreen] edit failed:', e);
        setEditing(target);
        setText(body);
        setSendError(t('errors.generic'));
      }
      return;
    }

    setSending(true);
    setSendError(null);
    const previous = text;
    setText('');
    const reply = replyTo
      ? {
          id: replyTo.id,
          type: replyTo.type as import('@/types').MessageType,
          body: replyTo.body,
          sender_id: replyTo.sender_id,
        }
      : null;
    setReplyTo(null);
    try {
      await messageService.send({
        conversationId,
        partnerId,
        senderId: myId,
        body,
        replyTo: reply,
      });
      await reload();
      void syncNow({ force: true });
    } catch (e) {
      console.warn('[ChatScreen] send failed:', e);
      setText(previous); // on rend le texte a l'utilisateur
      setSendError(t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  /** Envoi d'un message avec pièce jointe (média déjà uploadé). */
  const sendAttachment = useCallback(
    async (
      type: MessageType,
      attachmentUrl: string | null,
      attachmentMeta: Record<string, unknown> | null,
      body = '',
    ) => {
      setSendError(null);
      ensureAccepted();
      if (!canSendNow()) return;
      try {
        await messageService.send({
          conversationId,
          partnerId,
          senderId: myId,
          type,
          body,
          attachmentUrl,
          attachmentMeta,
        });
        await reload();
        void syncNow({ force: true });
      } catch (e) {
        console.warn('[ChatScreen] sendAttachment failed:', e);
        setSendError(t('errors.generic'));
      }
    },
    [conversationId, partnerId, myId, reload, t, ensureAccepted, canSendNow],
  );

  /** Envoi offline-first d'un fichier local (upload différé par l'outbox). */
  const sendLocalMedia = useCallback(
    async (local: LocalMediaFile, viewOnce = false) => {
      setSendError(null);
      ensureAccepted();
      if (!canSendNow()) return;
      try {
        await pendingMediaService.sendMedia({
          conversationId,
          partnerId,
          senderId: myId,
          local,
          viewOnce,
        });
        await reload();
        void syncNow({ force: true }); // best-effort : part maintenant si en ligne
      } catch (e) {
        console.warn('[ChatScreen] sendLocalMedia failed:', e);
        setSendError(t('errors.generic'));
      }
    },
    [conversationId, partnerId, myId, reload, t, ensureAccepted, canSendNow],
  );

  const openPreview = useCallback(
    (local: LocalMediaFile) =>
      navigation.navigate('ChatMediaPreview', {
        conversationId,
        partnerId,
        senderId: myId,
        local,
      }),
    [navigation, conversationId, partnerId, myId],
  );

  const onPickEmoji = useCallback(
    (emoji: string) => {
      onChangeText(text + emoji);
    },
    [text, onChangeText],
  );

  /** Icône caméra du composer : ouvre directement l'appareil photo natif
   * (photo ET vidéo, bascule intégrée à l'interface caméra de l'OS). */
  const onCameraPick = useCallback(async () => {
    const local = await picker.pickCameraLocal();
    if (local) openPreview(local);
  }, [picker, openPreview]);

  const onAttachPick = useCallback(
    async (kind: AttachKind) => {
      if (kind === 'gallery' || kind === 'camera') {
        // aperçu (crop + légende) AVANT tout upload — comme WhatsApp
        const local = await picker.pickImageLocal({ camera: kind === 'camera' });
        if (local) openPreview(local);
        return;
      }
      if (kind === 'video') {
        const local = await picker.pickVideoLocal();
        if (local) openPreview(local);
        return;
      }
      if (kind === 'file') {
        // pas d'édition possible, mais une confirmation courte (avec le
        // bouton "1" vue-unique) avant l'envoi réel — comme pour le vocal.
        const local = await picker.pickDocumentLocal();
        if (local) {
          setFileViewOnce(false);
          setPendingFile(local);
        }
        return;
      }
      if (kind === 'location') {
        // pas de fichier -> déjà 100% offline via l'outbox send_message
        const loc = await picker.pickLocation();
        // `pickLocation` affiche déjà un message précis en cas d'échec.
        if (loc) {
          await sendAttachment(
            'location',
            null,
            { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy },
          );
        }
      }
    },
    [picker, openPreview, sendLocalMedia, sendAttachment],
  );

  const onOpenMedia = useCallback(
    (m: LocalMessage) => {
      const raw = mediaUrl(m.attachment_url);
      if (!raw) return;
      // si déjà téléchargé -> on ouvre le FICHIER LOCAL (marche hors-ligne)
      const local = mediaCache.localFor(m.attachment_url);
      navigation.navigate('MediaViewer', {
        url: local ?? raw,
        type: m.type === 'video' ? 'video' : 'image',
        thumbnailUrl: mediaUrl(
          (m.attachment_meta?.thumbnail_url as string | undefined) ?? undefined,
        ),
        // vidéo reçue -> horodate « ouvert » pour l'expéditeur (écran Infos)
        messageId:
          m.type === 'video' && m.sender_id !== myId && !m.pending ? m.id : undefined,
      });
    },
    [navigation, myId],
  );

  const onVoicePlayed = useCallback(
    (messageId: string) => {
      void messageRepo.markVoicePlayed(messageId).then(reload);
    },
    [reload],
  );

  const onOpenFile = useCallback(
    async (m: LocalMessage) => {
      // télécharge d'abord si besoin, puis ouvre le fichier local
      const local =
        mediaCache.localFor(m.attachment_url) ?? (await mediaCache.fetchNow(m.attachment_url));
      const target = local ?? mediaUrl(m.attachment_url);
      if (target) void Linking.openURL(target).catch(() => showAlert(t('errors.generic')));
    },
    [t],
  );

  /** Le destinataire vient de taper sur une pièce jointe vue-unique
   * (photo/vidéo/vocal/fichier) encore verrouillée. IMPORTANT : on affiche/
   * télécharge TOUJOURS le média AVANT de prévenir le serveur — celui-ci
   * supprime le fichier définitivement dès la confirmation, donc l'ordre
   * inverse (confirmer puis afficher) renvoyait une erreur 404 au moment
   * même de l'ouverture. Photo/vidéo : `MediaViewer` gère lui-même le
   * téléchargement temporaire + la confirmation à sa fermeture (voir
   * `viewOnceMessageId`). Vocal/fichier : téléchargés ici dans un dossier
   * temporaire, confirmés+effacés après lecture/ouverture. */
  const onOpenViewOnce = useCallback(
    async (m: LocalMessage) => {
      if (m.type === 'image' || m.type === 'video') {
        const raw = mediaUrl(m.attachment_url);
        if (!raw) return;
        navigation.navigate('MediaViewer', {
          url: raw,
          type: m.type === 'video' ? 'video' : 'image',
          thumbnailUrl: mediaUrl(
            (m.attachment_meta?.thumbnail_url as string | undefined) ?? undefined,
          ),
          viewOnceMessageId: m.id,
        });
        return;
      }
      if (m.type === 'voice') {
        const local = await mediaCache.fetchTemp(m.attachment_url);
        if (!local) {
          showAlert(t('errors.generic'));
          return;
        }
        await toggleVoice(local, { conversationId: m.conversation_id, title: partnerName });
        // attend la VRAIE fin de lecture (pas juste le lancement) avant de
        // nettoyer — un vocal de 3 min doit rester audible jusqu'au bout.
        // `state.playing` redevient false soit à la fin naturelle, soit si
        // l'utilisateur arrête/quitte manuellement (stopVoice ailleurs).
        await new Promise<void>((resolve) => {
          const check = (): boolean => {
            const s = getVoiceState();
            return s.url !== local || !s.playing;
          };
          if (check()) {
            resolve();
            return;
          }
          const unsub = subscribeVoice(() => {
            if (check()) {
              unsub();
              resolve();
            }
          });
        });
        await messageService.openViewOnce(m.id).catch(() => undefined);
        await mediaCache.deleteTemp(local);
        void reload();
        return;
      }
      if (m.type === 'file') {
        const local = await mediaCache.fetchTemp(m.attachment_url);
        if (!local) {
          showAlert(t('errors.generic'));
          return;
        }
        await Linking.openURL(local).catch(() => showAlert(t('errors.generic')));
        // le fichier s'ouvre dans une app EXTERNE (lecteur PDF, etc.) — on ne
        // sait pas quand l'utilisateur a fini de le consulter là-bas, donc on
        // nettoie au retour dans E-discussion plutôt qu'après un délai fixe
        // (qui casserait l'affichage si l'app externe met plus de temps).
        await new Promise<void>((resolve) => {
          const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
            if (s === 'active') {
              sub.remove();
              resolve();
            }
          });
        });
        await messageService.openViewOnce(m.id).catch(() => undefined);
        await mediaCache.deleteTemp(local);
        void reload();
      }
    },
    [navigation, reload, t, partnerName],
  );

  const onOpenLocation = useCallback((lat: number, lng: number) => {
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}`;
    void Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
    );
  }, []);

  // ── Enregistrement d'une note vocale — UN TAP démarre (verrouillé
  // d'emblée : corbeille / pause-reprise / envoyer), un second tap envoie.
  // Plus d'appui maintenu ni de glisser pour verrouiller/annuler.
  const recStartedRef = useRef(false);
  const cancelledRef = useRef(false);
  const [recLocked, setRecLocked] = useState(true);

  const stopTyping = useCallback(() => {
    sendTyping(conversationId, 'stop', 'audio');
  }, [sendTyping, conversationId]);

  /** Tap sur le micro : démarre l'enregistrement immédiatement, direct en
   * mode verrouillé (pas d'étape « glisser pour verrouiller »). */
  const startVoiceTap = useCallback(async () => {
    if (recStartedRef.current) return;
    cancelledRef.current = false;
    setRecLocked(true);
    if (typingTimeout.current) {
      clearTimeout(typingTimeout.current);
      typingTimeout.current = null;
    }
    const ok = await picker.startRecording();
    recStartedRef.current = ok;
    if (ok) sendTyping(conversationId, 'start', 'audio');
  }, [picker, sendTyping, conversationId]);

  /** Bouton envoyer de la barre verrouillée : arrête et envoie la note. */
  const finalizeRecording = useCallback(async () => {
    if (!recStartedRef.current) return;
    recStartedRef.current = false;
    stopTyping();
    if (cancelledRef.current || picker.recordSeconds < 1) {
      await picker.cancelRecording();
      setVoiceViewOnce(false);
      return;
    }
    const local = await picker.stopRecordingLocal();
    const viewOnce = voiceViewOnce;
    setVoiceViewOnce(false);
    if (local) await sendLocalMedia(local, viewOnce);
  }, [picker, sendLocalMedia, stopTyping, voiceViewOnce]);

  /** Bouton corbeille de la barre verrouillée : annule sans envoyer. */
  const cancelVoice = useCallback(async () => {
    cancelledRef.current = true;
    recStartedRef.current = false;
    stopTyping();
    await picker.cancelRecording();
  }, [picker, stopTyping]);

  /** Appui long sur un message -> feuille d'actions. Un message déjà
   * `deleted_at` reste appuyable : seule l'action « Supprimer » a un sens
   * (retire définitivement la ligne fantôme de l'écran), voir `doDeleteForMe`. */
  const onMessageLongPress = (m: LocalMessage) => {
    setActionMsg(m);
  };

  const doReact = (emoji: string | null) => {
    if (!actionMsg || actionMsg.deleted_at) return;
    void messageService.react(actionMsg.id, emoji).then(reload).catch(() => undefined);
  };
  const doReply = () => {
    if (actionMsg) setReplyTo(actionMsg);
  };
  const pinWithDuration = (m: LocalMessage, duration: PinDuration) => {
    void conversationService
      .pinMessage(conversationId, m.id, duration)
      .then(reloadPinned)
      .catch((e: unknown) => {
        const msg =
          e instanceof ApiError && e.code === 'pin_limit_reached'
            ? t('chat.pinLimitReached')
            : t('chat.pinFailed');
        showToast(msg, { type: 'error' });
      });
  };

  const doPin = () => {
    const m = actionMsg;
    if (!m) return;
    const alreadyPinned = pinnedMessages.some((p) => p.message_id === m.id);
    if (alreadyPinned) {
      void conversationService
        .unpinMessage(conversationId, m.id)
        .then(reloadPinned)
        .catch(() => showToast(t('chat.unpinFailed'), { type: 'error' }));
      return;
    }
    showSheet({
      title: t('chat.pinDurationTitle'),
      actions: (['24h', '7d', '30d', 'forever'] as PinDuration[]).map((d) => ({
        label: t(`chat.pinDuration_${d}`),
        icon: d === 'forever' ? 'pin' : 'timer-outline',
        onPress: () => pinWithDuration(m, d),
      })),
    });
  };
  const doForward = () => {
    const m = actionMsg;
    if (!m) return;
    // Nom de l'AUTEUR ORIGINAL — pas celui qui clique "Transférer". Si `m`
    // est déjà lui-même un transfert, on propage son `forwarded_from_name`
    // (l'auteur d'origine, pas le dernier relais) plutôt que de l'écraser.
    const forwardedFromName =
      m.forwarded_from_name ?? (m.sender_id === myId ? me?.display_name || me?.username : partnerName) ?? null;
    void (async () => {
      const ids = await selectContacts({ title: t('chat.forwardSelectTitle') });
      if (!ids || ids.length === 0) return;

      let ok = 0;
      let fail = 0;
      let blockedCount = 0;
      for (const contactId of ids) {
        try {
          const detail = await conversationService.start(contactId);
          await messageService.send({
            conversationId: detail.id,
            partnerId: contactId,
            senderId: myId,
            type: m.type,
            body: m.body,
            attachmentUrl: m.attachment_url,
            attachmentMeta: m.attachment_meta,
            forwardedFromId: m.id,
            forwardedFromName,
          });
          ok += 1;
        } catch (e) {
          console.warn('[forward] échec pour', contactId, ':', e);
          if (e instanceof ApiError && (e.status === 403 || e.code === 'blocked')) blockedCount += 1;
          else fail += 1;
        }
      }
      if (ok > 0) showToast(t('chat.forwardSent', { count: ok }));
      if (blockedCount > 0) showToast(t('chat.forwardFailedBlocked', { count: blockedCount }), { type: 'error' });
      if (fail > 0) showToast(t('chat.forwardFailed', { count: fail }), { type: 'error' });
    })();
  };
  const doDeleteForMe = () => {
    if (!actionMsg) return;
    // déjà marqué supprimé (ex: message dont le serveur n'a plus trace) ->
    // un simple re-marquage ne changerait rien à l'affichage ; on retire la
    // ligne fantôme du cache local pour de bon.
    if (actionMsg.deleted_at) {
      void messageRepo.purgeLocal(actionMsg.id).then(reload);
      return;
    }
    void messageRepo.markDeleted(actionMsg.id).then(reload);
  };
  const doDeleteForEveryone = () => {
    if (!actionMsg) return;
    void messageService.remove(actionMsg.id).then(reload).catch(() => undefined);
  };
  const doEditFromSheet = () => {
    if (!actionMsg) return;
    setEditing(actionMsg);
    setText(actionMsg.body);
  };
  const doCopy = () => {
    if (actionMsg?.body) Clipboard.setString(actionMsg.body);
  };

  /** Envoi direct d'une suggestion de réponse rapide (conversation vide). */
  const sendQuick = useCallback(
    async (body: string) => {
      ensureAccepted();
      if (!canSendNow()) return;
      try {
        await messageService.send({ conversationId, partnerId, senderId: myId, body });
        await reload();
        void syncNow({ force: true });
      } catch (e) {
        console.warn('[ChatScreen] quick send failed:', e);
        setSendError(t('errors.generic'));
      }
    },
    [conversationId, partnerId, myId, reload, t, ensureAccepted, canSendNow],
  );

  const retry = async (m: LocalMessage) => {
    if (!m.client_id) return;
    // média échoué
    if (
      (m.type === 'image' || m.type === 'video' || m.type === 'voice' || m.type === 'file') &&
      m.attachment_url
    ) {
      const meta = m.attachment_meta ?? {};
      const alreadyUploaded = !/^(file:|content:)/.test(m.attachment_url);
      if (alreadyUploaded) {
        // l'upload avait réussi : il ne reste que l'envoi du message
        await sendAttachment(m.type, m.attachment_url, meta, m.body);
      } else {
        await pendingMediaService.sendMedia({
          conversationId,
          partnerId,
          senderId: myId,
          body: m.body,
          local: {
            file: {
              uri: m.attachment_url,
              name: (meta.name as string) || `media_${Date.now()}`,
              type: (meta.mime as string) || 'application/octet-stream',
            },
            kind: m.type,
            size: (meta.size as number) ?? null,
            width: (meta.width as number) ?? null,
            height: (meta.height as number) ?? null,
            durationSec: (meta.duration_sec as number) ?? null,
          },
        });
      }
      await messageRepo.markDeleted(m.id);
      await reload();
      void syncNow({ force: true });
      return;
    }
    // texte : re-enfile l'envoi et relance
    await messageService.send({
      conversationId,
      partnerId,
      senderId: myId,
      body: m.body,
    });
    await messageRepo.markDeleted(m.id); // masque l'ancienne ligne "failed"
    await reload();
    void syncNow({ force: true });
  };

  const placeCall = (kind: 'voice' | 'video') => {
    // 'ended' est un état transitoire (~1.6s après un appel précédent) —
    // pas un appel en cours ; `startCall` gère déjà ce cas correctement.
    if (callPhase !== 'idle' && callPhase !== 'ended') return;
    if (!callsAvailable) {
      showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    startCall(
      {
        id: partnerId,
        username: null,
        display_name: partnerName,
        avatar_url: partnerAvatar ?? null,
        about: null,
        last_seen_at: null,
        is_online: partnerOnline,
      },
      kind,
    ).catch((e: unknown) => {
      showAlert(t('calls.startFailed'), callStartErrorMessage(e, t('calls.startFailedBody')));
    });
  };

  const openInfo = () =>
    navigation.navigate('ConversationInfo', {
      conversationId,
      partnerId,
      partnerName,
      partnerAvatar,
    });

  const toggleMute = async () => {
    const next = !muted;
    setMuted(next);
    try {
      await conversationService.setMuted(conversationId, next);
      showToast(next ? t('chat.muted') : t('chat.unmuted'));
    } catch {
      setMuted(!next);
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  const doClear = () =>
    confirmAlert(
      t('chat.clearTitle'),
      t('chat.clearBody'),
      async () => {
        try {
          await conversationService.clearHistory(conversationId);
          await reload();
          showToast(t('chat.cleared'));
        } catch {
          showToast(t('errors.generic'), { type: 'error' });
        }
      },
      { destructive: true, confirmText: t('common.delete') },
    );

  const doBlock = () =>
    confirmAlert(
      t('chat.blockTitle', { name: partnerName }),
      t('chat.blockBody'),
      async () => {
        try {
          await userService.block(partnerId);
          setBlocked(true);
          showToast(t('chat.userBlocked'));
        } catch {
          showToast(t('errors.generic'), { type: 'error' });
        }
      },
      { destructive: true, confirmText: t('chat.block') },
    );

  const doUnblock = async () => {
    try {
      await userService.unblock(partnerId);
      setBlocked(false);
      void refreshDetail();
      showToast(t('settings.userUnblocked'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    }
  };

  /** Bannière de demande entrante — acceptation explicite (en plus de
   * l'acceptation implicite au premier envoi, voir `ensureAccepted`). */
  const doAcceptRequest = () => {
    requestStatusRef.current = 'accepted';
    setRequestStatusUi('accepted');
    void conversationService.accept(conversationId).catch(() => undefined);
  };

  /** Refuser une demande entrante est réversible et silencieux : la
   * conversation disparaît de MA liste (comme `hide`) sans notifier
   * l'expéditeur ; s'il réécrit plus tard, la demande revient normalement. */
  const doDeclineRequest = () =>
    confirmAlert(
      t('chat.declineRequestTitle'),
      t('chat.declineRequestBody', { name: partnerName }),
      async () => {
        try {
          await conversationService.decline(conversationId);
          await conversationService.hide(conversationId).catch(() => undefined);
          navigation.goBack();
        } catch {
          showToast(t('errors.generic'), { type: 'error' });
        }
      },
      { destructive: true, confirmText: t('chat.decline') },
    );

  const doBlockRequest = () =>
    confirmAlert(
      t('chat.blockTitle', { name: partnerName }),
      t('chat.blockBody'),
      async () => {
        try {
          await conversationService.decline(conversationId);
          await userService.block(partnerId);
          navigation.goBack();
          showToast(t('chat.userBlocked'));
        } catch {
          showToast(t('errors.generic'), { type: 'error' });
        }
      },
      { destructive: true, confirmText: t('chat.block') },
    );

  const menuActions: ChatMenuAction[] = [
    { key: 'info', icon: 'account-circle-outline', label: t('chat.menuInfo'), onPress: openInfo },
    {
      key: 'media',
      icon: 'image-multiple-outline',
      label: t('chat.menuMedia'),
      onPress: openInfo,
    },
    {
      key: 'mute',
      icon: muted ? 'bell-outline' : 'bell-off-outline',
      label: muted ? t('chat.menuUnmute') : t('chat.menuMute'),
      onPress: () => void toggleMute(),
    },
    {
      key: 'wallpaper',
      icon: 'wallpaper',
      label: t('chat.menuWallpaper'),
      onPress: () => navigation.navigate('ChatsSettings'),
    },
    {
      key: 'encryption',
      icon: 'shield-lock-outline',
      label: t('chat.menuEncryption'),
      onPress: () => setEncOpen(true),
    },
    { key: 'block', icon: 'account-cancel-outline', label: t('chat.menuBlock'), danger: true, onPress: doBlock },
    { key: 'clear', icon: 'trash-can-outline', label: t('chat.menuClear'), danger: true, onPress: doClear },
  ];

  const c = theme.colors;

  // si MA connexion est coupée, je ne peux pas savoir si le partenaire est en
  // ligne -> on n'affiche plus le point vert ni « en ligne » (comme WhatsApp).
  // bloqué -> aucune présence, aucun « vu à … » (dans les deux sens).
  const partnerOnlineEffective = !blocked && online && partnerOnline;
  const subtitle = blocked
    ? ''
    : partnerTyping
      ? partnerActivity === 'audio'
        ? t('chat.recordingAudio')
        : t('common.typing')
      : !online
        ? lastSeenLabel(partnerLastSeen, false)
        : lastSeenLabel(partnerLastSeen, partnerOnlineEffective);

  // fond de conversation selon la préférence (couleur unie ou dégradé simple)
  const chatBg =
    wallpaper.key === 'default'
      ? c.chatBackground
      : wallpaper.colors[0] || c.chatBackground;

  return (
    <Screen edges={[]} style={{ backgroundColor: chatBg }}>
      {wallpaper.type === 'gradient' && wallpaper.key !== 'default' ? (
        <View
          pointerEvents="none"
          style={[
            styles.wallpaperOverlay,
            { backgroundColor: wallpaper.colors[1], opacity: 0.5 },
          ]}
        />
      ) : null}
      <AppHeader
        rounded={false}
        compact
        full={
          <>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
              <Icon name="arrow-left" size={24} color={c.onHeader} />
            </Pressable>
            <Pressable style={styles.headerId} hitSlop={6} onPress={openInfo}>
              <Avatar
                uri={partnerAvatar}
                name={partnerName}
                size={38}
                online={partnerOnlineEffective}
              />
              <View style={styles.headerText}>
                <Text style={[styles.headerName, { color: c.onHeader }]} numberOfLines={1}>
                  {partnerName}
                </Text>
                <Text
                  style={[
                    styles.headerSub,
                    { color: partnerTyping || partnerOnlineEffective ? c.onHeader : c.onHeaderMuted },
                  ]}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              </View>
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable hitSlop={10} onPress={() => placeCall('video')}>
                <Icon name="video-outline" size={22} color={c.onHeader} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => placeCall('voice')}>
                <Icon name="phone-outline" size={21} color={c.onHeader} />
              </Pressable>
              <Pressable
                hitSlop={10}
                onPress={() =>
                  navigation.navigate('ChatSearch', {
                    mode: 'dm',
                    conversationId,
                    partnerId,
                    partnerName,
                    partnerAvatar,
                  })
                }
              >
                <Icon name="magnify" size={21} color={c.onHeader} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => setMenuOpen(true)}>
                <Icon name="dots-vertical" size={22} color={c.onHeader} />
              </Pressable>
            </View>
          </>
        }
      />
      <SyncBanner />
      <PinnedBanner pinned={pinnedMessages} />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          // Android : l'activité est déjà en `windowSoftInputMode="adjustResize"`
          // (voir AndroidManifest) — le système redimensionne la fenêtre tout
          // seul. Ajouter behavior="height" par-dessus fait cumuler DEUX
          // redimensionnements qui se désynchronisent à la fermeture du
          // clavier : le composer reste "flottant" au lieu de redescendre à
          // sa place. Sur Android on laisse donc `undefined` (pas d'action
          // de KeyboardAvoidingView, le système gère tout).
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          <FlatList
            ref={listRef}
            data={items}
            inverted
            keyExtractor={(it) => (it.kind === 'msg' ? it.m.id : it.key)}
            contentContainerStyle={
              items.length === 0
                ? styles.emptyContent
                : { paddingVertical: 10 }
            }
            // secours classique FlatList : l'index ciblé n'est pas encore
            // mesuré (item hors zone déjà rendue) -> on scrolle approximativement
            // par offset puis on retente le scrollToIndex exact.
            onScrollToIndexFailed={(info) => {
              listRef.current?.scrollToOffset({
                offset: info.averageItemLength * info.index,
                animated: false,
              });
              setTimeout(() => {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.5,
                });
              }, 100);
            }}
            ListHeaderComponent={
              partnerTyping ? (
                <View style={styles.typingRow}>
                  <View style={[styles.typingBubble, { backgroundColor: c.bubbleIn }]}>
                    <Icon
                      name={partnerActivity === 'audio' ? 'microphone' : 'dots-horizontal'}
                      size={18}
                      color={c.bubbleInText}
                    />
                    <Text style={[styles.typingTxt, { color: c.bubbleInText }]}>
                      {partnerActivity === 'audio'
                        ? t('chat.recordingAudio')
                        : t('common.typing')}
                    </Text>
                  </View>
                </View>
              ) : null
            }
            // liste inversée : `onEndReached` = on approche du HAUT visuel =
            // charger des messages plus anciens (voir `loadOlder`).
            onEndReachedThreshold={0.5}
            onEndReached={() => void loadOlder()}
            ListFooterComponent={
              items.length === 0 ? null : (
                <>
                  {loadingOlder ? (
                    <View style={styles.olderLoading}>
                      <ActivityIndicator size="small" color={c.textMuted} />
                    </View>
                  ) : null}
                  {E2EE_ENABLED ? (
                    <Pressable style={styles.encBanner} onPress={() => setEncOpen(true)}>
                      <Icon name="lock" size={12} color={c.textMuted} />
                      <Text style={[styles.encBannerTxt, { color: c.textMuted }]}>
                        {t('chat.encBanner')}
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              )
            }
            renderItem={({ item, index }) => {
              if (item.kind === 'day') {
                return (
                  <View style={styles.dayWrap}>
                    <View style={[styles.dayPill, { backgroundColor: c.surfaceAlt }]}>
                      <Text style={[styles.dayText, { color: c.textMuted }]}>{item.label}</Text>
                    </View>
                  </View>
                );
              }
              if (item.kind === 'unread') {
                return (
                  <View style={styles.unreadWrap}>
                    <View style={[styles.unreadLine, { backgroundColor: c.primary + '55' }]} />
                    <View style={[styles.unreadPill, { backgroundColor: c.primary + '1A' }]}>
                      <Text style={[styles.unreadText, { color: c.primary }]}>
                        {t('chat.unreadDivider', { count: item.count })}
                      </Text>
                    </View>
                    <View style={[styles.unreadLine, { backgroundColor: c.primary + '55' }]} />
                  </View>
                );
              }
              const prev = items[index + 1]; // liste inversée → suivant = plus ancien
              const grouped =
                prev?.kind === 'msg' && prev.m.sender_id === item.m.sender_id;
              const mine = item.m.sender_id === myId;
              const bubble = (
                <MessageBubble
                  message={item.m}
                  mine={mine}
                  grouped={grouped}
                  onLongPress={() => onMessageLongPress(item.m)}
                  onRetry={() => retry(item.m)}
                  onOpenMedia={onOpenMedia}
                  onOpenFile={onOpenFile}
                  onOpenLocation={onOpenLocation}
                  onVoicePlayed={onVoicePlayed}
                  onOpenViewOnce={onOpenViewOnce}
                  voiceTitle={partnerName}
                  senderAvatar={mine ? me?.avatar_url : partnerAvatar}
                  senderName={mine ? t('common.you') : partnerName}
                />
              );
              // surlignage temporaire du message ciblé par un "jump to
              // message" depuis la recherche — juste un fond teinté, retiré
              // après un délai (voir l'effet plus haut).
              if (item.m.id === highlightedMessageId) {
                return (
                  <View style={{ backgroundColor: c.primary + '22' }}>{bubble}</View>
                );
              }
              return bubble;
            }}
          />

          {items.length === 0 && !blocked ? (
            // affiché en dehors de la FlatList (jamais comme ListEmptyComponent) :
            // React Native retourne aussi ListEmptyComponent sur une liste
            // `inverted` (bug connu, non résolu même avec un contre-flip
            // scaleY manuel — https://github.com/facebook/react-native/issues/21196),
            // ce qui affichait ce bloc à l'envers. En le sortant complètement
            // de la liste, il n'est jamais soumis à cette rotation.
            <View style={styles.emptyOverlay} pointerEvents="box-none">
              <QuickReplies partnerName={partnerName} onSend={(txt) => void sendQuick(txt)} />
            </View>
          ) : null}

          {blocked ? (
            <View
              style={[
                styles.requestBar,
                {
                  backgroundColor: c.surface,
                  borderTopColor: c.divider,
                  paddingBottom: 16 + insets.bottom,
                },
              ]}
            >
              <Text style={{ color: c.textMuted, marginBottom: 10, textAlign: 'center' }}>
                {t('chat.blockedBanner')}
              </Text>
              <Button label={t('chat.unblock')} variant="secondary" onPress={doUnblock} />
            </View>
          ) : requestStatusUi === 'pending_incoming' ? (
            <View
              style={[
                styles.requestBar,
                {
                  backgroundColor: c.surface,
                  borderTopColor: c.divider,
                  paddingBottom: 16 + insets.bottom,
                },
              ]}
            >
              <Text style={{ color: c.textMuted, marginBottom: 10, textAlign: 'center' }}>
                {t('chat.requestIncomingBanner', { name: partnerName })}
              </Text>
              <View style={styles.requestActionsRow}>
                <Button
                  label={t('chat.decline')}
                  variant="secondary"
                  onPress={doDeclineRequest}
                  style={styles.requestActionBtn}
                />
                <Button
                  label={t('chat.block')}
                  variant="secondary"
                  onPress={doBlockRequest}
                  style={styles.requestActionBtn}
                />
                <Button
                  label={t('chat.accept')}
                  onPress={doAcceptRequest}
                  style={styles.requestActionBtn}
                />
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: c.card,
                  borderTopColor: c.divider,
                  paddingBottom: 8 + insets.bottom,
                },
              ]}
            >
              {sendError ? (
                <Text style={[styles.sendError, { color: c.danger }]}>{sendError}</Text>
              ) : null}
              {editing ? (
                <View style={[styles.editBar, { borderLeftColor: c.primary }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.editLabel, { color: c.primary }]}>
                      {t('common.edit')}
                    </Text>
                    <Text style={[styles.editPreview, { color: c.textMuted }]} numberOfLines={1}>
                      {editing.body}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setEditing(null);
                      setText('');
                    }}
                    hitSlop={8}
                  >
                    <Icon name="close" size={18} color={c.textMuted} />
                  </Pressable>
                </View>
              ) : replyTo ? (
                <View style={[styles.editBar, { borderLeftColor: c.primary }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.editLabel, { color: c.primary }]}>
                      {t('chat.replyingTo')}{' '}
                      {replyTo.sender_id === myId ? t('chat.replySelf') : partnerName}
                    </Text>
                    <Text style={[styles.editPreview, { color: c.textMuted }]} numberOfLines={1}>
                      {replyTo.body || `[${replyTo.type}]`}
                    </Text>
                  </View>
                  <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
                    <Icon name="close" size={18} color={c.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              {pendingFile ? (
                // ── confirmation d'envoi d'un FICHIER (pas d'écran d'aperçu
                // dédié comme photo/vidéo) — même bouton "1" vue-unique. ────
                <View style={styles.lockedRow}>
                  <Pressable
                    onPress={() => setPendingFile(null)}
                    hitSlop={10}
                    style={styles.lockedBtn}
                  >
                    <Icon name="close" size={22} color={c.textMuted} />
                  </Pressable>
                  <View style={[styles.lockedCenter, { backgroundColor: c.surface }]}>
                    <Icon name="file-document-outline" size={16} color={c.textMuted} />
                    <Text style={[styles.recText, { color: c.text }]} numberOfLines={1}>
                      {pendingFile.file.name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setFileViewOnce((v) => !v)}
                    hitSlop={10}
                    style={[
                      styles.viewOnceToggle,
                      { borderColor: fileViewOnce ? c.primary : c.textFaint },
                      fileViewOnce && { backgroundColor: c.primary + '18' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.viewOnceToggleText,
                        { color: fileViewOnce ? c.primary : c.textFaint },
                      ]}
                    >
                      1
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => {
                      const f = pendingFile;
                      const vo = fileViewOnce;
                      setPendingFile(null);
                      setFileViewOnce(false);
                      if (f) void sendLocalMedia(f, vo);
                    }}
                    style={[styles.sendBtn, { backgroundColor: c.primary }]}
                  >
                    <Icon name="send" size={19} color="#fff" />
                  </Pressable>
                </View>
              ) : picker.recording && recLocked ? (
                // ── barre d'enregistrement VERROUILLÉ ──────────────────────
                <View style={styles.lockedRow}>
                  <Pressable
                    onPress={() => void cancelVoice()}
                    hitSlop={10}
                    style={styles.lockedBtn}
                  >
                    <Icon name="trash-can-outline" size={24} color={c.danger} />
                  </Pressable>
                  <View style={[styles.lockedCenter, { backgroundColor: c.surface }]}>
                    {!picker.recordingPaused ? (
                      <View style={[styles.recDot, { backgroundColor: c.danger }]} />
                    ) : (
                      <Icon name="pause" size={14} color={c.textMuted} />
                    )}
                    <Text style={[styles.recText, { color: c.text }]}>
                      {Math.floor(picker.recordSeconds / 60)}:
                      {String(picker.recordSeconds % 60).padStart(2, '0')}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() =>
                      void (picker.recordingPaused
                        ? picker.resumeRecording()
                        : picker.pauseRecording())
                    }
                    hitSlop={10}
                    style={styles.lockedBtn}
                  >
                    <Icon
                      name={picker.recordingPaused ? 'play' : 'pause'}
                      size={24}
                      color={c.primary}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => setVoiceViewOnce((v) => !v)}
                    hitSlop={10}
                    style={[
                      styles.viewOnceToggle,
                      { borderColor: voiceViewOnce ? c.primary : c.textFaint },
                      voiceViewOnce && { backgroundColor: c.primary + '18' },
                    ]}
                  >
                    <Text
                      style={[
                        styles.viewOnceToggleText,
                        { color: voiceViewOnce ? c.primary : c.textFaint },
                      ]}
                    >
                      1
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() => void finalizeRecording()}
                    style={[styles.sendBtn, { backgroundColor: c.primary }]}
                  >
                    <Icon name="send" size={19} color="#fff" />
                  </Pressable>
                </View>
              ) : (
                <>
                  <View style={[styles.inputWrap, { backgroundColor: c.surface }]}>
                    <Pressable
                      hitSlop={8}
                      onPress={() => setEmojiOpen(true)}
                      disabled={picker.recording}
                    >
                      <Icon name="emoticon-happy-outline" size={22} color={c.textFaint} />
                    </Pressable>
                    <TextInput
                      value={text}
                      onChangeText={onChangeText}
                      placeholder={
                        picker.recording ? t('chat.recording') : t('conversations.typeMessage')
                      }
                      placeholderTextColor={c.textFaint}
                      editable={!picker.recording}
                      multiline={!enterToSend}
                      blurOnSubmit={false}
                      returnKeyType={enterToSend ? 'send' : 'default'}
                      onSubmitEditing={enterToSend ? () => void send() : undefined}
                      style={[styles.input, { color: c.text }]}
                    />
                    <Pressable
                      hitSlop={8}
                      onPress={() => void onCameraPick()}
                      disabled={picker.recording}
                    >
                      <Icon name="camera-outline" size={21} color={c.textFaint} />
                    </Pressable>
                    <Pressable
                      hitSlop={8}
                      onPress={() => setAttachOpen(true)}
                      disabled={picker.recording}
                    >
                      <Icon name="paperclip" size={20} color={c.textFaint} />
                    </Pressable>
                  </View>
                  {text.trim() ? (
                    <Pressable
                      onPress={send}
                      style={[styles.sendBtn, { backgroundColor: c.primary }]}
                    >
                      <Icon name="send" size={19} color="#fff" />
                    </Pressable>
                  ) : (
                    <Pressable
                      onPress={() => void startVoiceTap()}
                      style={[styles.sendBtn, { backgroundColor: c.primary }]}
                    >
                      <Icon name="microphone" size={19} color="#fff" />
                    </Pressable>
                  )}
                </>
              )}
            </View>
          )}
        </KeyboardAvoidingView>
      )}

      <AttachMenu
        visible={attachOpen}
        onPick={(k) => void onAttachPick(k)}
        onClose={() => setAttachOpen(false)}
      />
      <EmojiSheet
        visible={emojiOpen}
        onPick={onPickEmoji}
        onClose={() => setEmojiOpen(false)}
      />
      <ChatMenuSheet
        visible={menuOpen}
        actions={menuActions}
        onClose={() => setMenuOpen(false)}
      />
      <MessageActionSheet
        visible={!!actionMsg}
        ctx={
          actionMsg
            ? {
                mine: actionMsg.sender_id === myId,
                hasText: !!actionMsg.body,
                encrypted: !!actionMsg.encrypted,
                currentReaction: actionMsg.reaction ?? null,
                canForward: actionMsg.sync_state === 'synced' && !actionMsg.deleted_at,
                isPinned: pinnedMessages.some((p) => p.message_id === actionMsg.id),
                canPin: actionMsg.sync_state === 'synced' && !actionMsg.deleted_at,
              }
            : null
        }
        onReact={doReact}
        onReply={actionMsg?.deleted_at ? undefined : doReply}
        onCopy={doCopy}
        onEdit={doEditFromSheet}
        onForward={doForward}
        onPin={doPin}
        onInfo={() => {
          const m = actionMsg;
          if (m) navigation.navigate('MessageInfo', { messageId: m.id, type: m.type });
        }}
        onDeleteForMe={doDeleteForMe}
        onDeleteForEveryone={doDeleteForEveryone}
        onClose={() => setActionMsg(null)}
      />
      <EncryptionInfoModal
        visible={encOpen}
        partnerName={partnerName}
        onClose={() => setEncOpen(false)}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  viewOnceToggle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewOnceToggleText: { fontSize: 13, fontWeight: '800' },
  // affiché par-dessus la FlatList (pas comme ListEmptyComponent) — voir le
  // commentaire au point d'appel.
  emptyOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center' },
  wallpaperOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  editLabel: { fontSize: 12, fontWeight: '800' },
  editPreview: { fontSize: 13, marginTop: 1 },
  backBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  headerId: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 2 },
  headerText: { flex: 1, justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 6 },
  headerName: { fontSize: 16.5, fontWeight: '700', letterSpacing: -0.2 },
  headerSub: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  dayWrap: { alignItems: 'center', marginVertical: 8 },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  unreadWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginVertical: 10,
    paddingHorizontal: 16,
  },
  unreadLine: { flex: 1, height: StyleSheet.hairlineWidth },
  unreadPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  unreadText: { fontSize: 12, fontWeight: '800', letterSpacing: 0.2 },
  dayText: { fontSize: 12, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendError: { width: '100%', fontSize: 12, marginBottom: 4, marginLeft: 6 },
  emptyContent: { flexGrow: 1, justifyContent: 'center' },
  recBar: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 6,
  },
  recDot: { width: 9, height: 9, borderRadius: 5 },
  recText: { fontSize: 13, fontWeight: '700' },
  recHint: { fontSize: 11, flex: 1, textAlign: 'right' },
  lockedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  lockedBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  lockedCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 22,
    paddingHorizontal: 16,
    height: 44,
  },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  input: {
    flex: 1,
    paddingTop: 6,
    paddingBottom: 6,
    fontSize: 15,
    maxHeight: 108,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  requestBar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  requestActionsRow: { flexDirection: 'row', gap: 8 },
  requestActionBtn: { flex: 1 },
  encBanner: {
    flexDirection: 'row',
    alignSelf: 'center',
    alignItems: 'center',
    gap: 5,
    maxWidth: '86%',
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginVertical: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(140,150,170,0.12)',
  },
  encBannerTxt: { fontSize: 11.5, textAlign: 'center', lineHeight: 15 },
  olderLoading: { paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  typingRow: { paddingHorizontal: 12, paddingTop: 4, paddingBottom: 6, alignItems: 'flex-start' },
  typingBubble: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 16,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  typingTxt: { fontSize: 13, fontStyle: 'italic' },
});
