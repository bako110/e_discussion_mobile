import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { AppHeader, Avatar, Button, Icon, Screen, SyncBanner, confirmAlert, showAlert } from '@/components/common';
import { AttachMenu, type AttachKind } from '@/components/chat/AttachMenu';
import { ChatMenuSheet, type ChatMenuAction } from '@/components/chat/ChatMenuSheet';
import { EncryptionInfoModal } from '@/components/chat/EncryptionInfoModal';
import { MessageActionSheet } from '@/components/chat/MessageActionSheet';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { QuickReplies } from '@/components/chat/QuickReplies';
import { useMediaPicker, type LocalMediaFile } from '@/hooks/useMediaPicker';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useChatPrefs } from '@/context/ChatPrefsContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { onLocalMessageEvent } from '@/context/MessageSync';
import type { LocalMessage } from '@/db/repositories/messageRepo';
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
import { retryFailedDecryptions, syncNow } from '@/sync/syncEngine';
import type { ChatMessage, MessageType, RequestStatus } from '@/types';
import { dayLabel, lastSeenLabel } from '@/utils/time';
import { mediaUrl } from '@/utils/media';

type Item = { kind: 'msg'; m: LocalMessage } | { kind: 'day'; label: string; key: string };

function withDaySeparators(messages: LocalMessage[]): Item[] {
  // messages triés du plus récent au plus ancien (liste inversée)
  const out: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    out.push({ kind: 'msg', m });
    const next = messages[i + 1];
    if (!next || new Date(m.created_at).toDateString() !== new Date(next.created_at).toDateString()) {
      out.push({ kind: 'day', label: dayLabel(m.created_at), key: `day-${m.id}` });
    }
  }
  return out;
}

export const ChatScreen: React.FC<MainScreenProps<'Chat'>> = ({ route, navigation }) => {
  const { conversationId, partnerId, partnerName, partnerAvatar } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const { addListener, sendTyping } = useWs();
  const { online } = useSync();
  const { wallpaper, enterToSend } = useChatPrefs();
  const { available: callsAvailable, startCall, phase: callPhase } = useCall();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('accepted');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerLastSeen, setPartnerLastSeen] = useState<string | null>(null);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [attachOpen, setAttachOpen] = useState(false);
  const picker = useMediaPicker();
  // message en cours d'édition (null = mode envoi normal)
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [replyTo, setReplyTo] = useState<LocalMessage | null>(null);
  const [actionMsg, setActionMsg] = useState<LocalMessage | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [encOpen, setEncOpen] = useState(false);
  const [muted, setMuted] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = me?.id ?? '';

  const reload = useCallback(async () => {
    const [page, conv] = await Promise.all([
      messageService.page(conversationId, 60),
      conversationRepo.get(conversationId),
    ]);
    setMessages(page);
    if (conv) {
      setRequestStatus(conv.request_status);
      setPartnerOnline(conv.partner.is_online);
    }
    setLoading(false);
  }, [conversationId]);

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
  }, [conversationId, partnerId]);

  useEffect(() => {
    void reload();
    void refreshDetail();
    // marque lu (local + outbox) + tente une sync delta pour cette conv
    void messageService.markRead(conversationId, myId);
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
      } else if (e.type === 'message.edited') {
        const em = e.message as ChatMessage | undefined;
        if (em?.conversation_id === conversationId && em.id) {
          void messageRepo
            .applyEdit(em.id, em.encrypted ? '' : em.body)
            .then(reload);
        }
      } else if (e.type === 'message.reaction') {
        void messageRepo.setReaction(e.message_id as string, (e.emoji as string) ?? null).then(reload);
      } else if (e.type === 'receipt.read' && e.conversation_id === conversationId) {
        void messageRepo.markMineRead(conversationId, myId).then(reload);
      } else if (e.type === 'receipt.delivered' && e.conversation_id === conversationId) {
        void messageRepo.markMineDelivered(e.message_id as string).then(reload);
      } else if (
        (e.type === 'typing.start' || e.type === 'typing.stop') &&
        e.conversation_id === conversationId &&
        e.user_id === partnerId
      ) {
        setPartnerTyping(e.type === 'typing.start');
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
    return off;
  }, [addListener, conversationId, partnerId, myId, reload]);

  const onChangeText = (v: string) => {
    setText(v);
    sendTyping(conversationId, 'start');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(conversationId, 'stop'), 1500);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;

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
    [conversationId, partnerId, myId, reload, t],
  );

  /** Envoi offline-first d'un fichier local (upload différé par l'outbox). */
  const sendLocalMedia = useCallback(
    async (local: LocalMediaFile) => {
      setSendError(null);
      try {
        await pendingMediaService.sendMedia({
          conversationId,
          partnerId,
          senderId: myId,
          local,
        });
        await reload();
        void syncNow({ force: true }); // best-effort : part maintenant si en ligne
      } catch (e) {
        console.warn('[ChatScreen] sendLocalMedia failed:', e);
        setSendError(t('errors.generic'));
      }
    },
    [conversationId, partnerId, myId, reload, t],
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
        // un document n'a pas besoin d'édition -> envoi direct
        const local = await picker.pickDocumentLocal();
        if (local) await sendLocalMedia(local);
        return;
      }
      if (kind === 'location') {
        // pas de fichier -> déjà 100% offline via l'outbox send_message
        const loc = await picker.pickLocation();
        if (loc) {
          await sendAttachment(
            'location',
            null,
            { latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy },
          );
        } else {
          showAlert(t('chat.attachLocation'), t('chat.locationFailed'));
        }
      }
    },
    [picker, openPreview, sendLocalMedia, sendAttachment, t],
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

  const onOpenLocation = useCallback((lat: number, lng: number) => {
    const url =
      Platform.OS === 'ios'
        ? `http://maps.apple.com/?ll=${lat},${lng}`
        : `geo:${lat},${lng}?q=${lat},${lng}`;
    void Linking.openURL(url).catch(() =>
      Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${lat},${lng}`),
    );
  }, []);

  // ── Enregistrement d'une note vocale (appui maintenu sur le bouton micro) ──
  const recStartedRef = useRef(false);
  const onMicPressIn = useCallback(async () => {
    recStartedRef.current = await picker.startRecording();
  }, [picker]);
  const onMicPressOut = useCallback(async () => {
    if (!recStartedRef.current) return;
    recStartedRef.current = false;
    // enregistrement trop court -> on annule
    if (picker.recordSeconds < 1) {
      await picker.cancelRecording();
      return;
    }
    const local = await picker.stopRecordingLocal();
    if (local) await sendLocalMedia(local);
  }, [picker, sendLocalMedia]);

  /** Appui long sur un message -> feuille d'actions. */
  const onMessageLongPress = (m: LocalMessage) => {
    if (m.deleted_at) return;
    setActionMsg(m);
  };

  const doReact = (emoji: string | null) => {
    if (!actionMsg) return;
    void messageService.react(actionMsg.id, emoji).then(reload).catch(() => undefined);
  };
  const doReply = () => {
    if (actionMsg) setReplyTo(actionMsg);
  };
  const doForward = () => {
    if (actionMsg?.body) {
      Clipboard.setString(actionMsg.body);
      showAlert(t('chat.forwardCopied'));
    }
  };
  const doDeleteForMe = () => {
    if (!actionMsg) return;
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
      try {
        await messageService.send({ conversationId, partnerId, senderId: myId, body });
        await reload();
        void syncNow({ force: true });
      } catch (e) {
        console.warn('[ChatScreen] quick send failed:', e);
        setSendError(t('errors.generic'));
      }
    },
    [conversationId, partnerId, myId, reload, t],
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

  const accept = async () => {
    await conversationService.accept(conversationId);
    setRequestStatus('accepted');
    void syncNow({ force: true });
  };
  const decline = async () => {
    await conversationService.decline(conversationId);
    navigation.goBack();
  };

  const placeCall = (kind: 'voice' | 'video') => {
    if (callPhase !== 'idle') return;
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
      const msg = e instanceof Error ? e.message : t('calls.startFailed');
      showAlert(t('calls.startFailed'), msg);
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
    } catch {
      setMuted(!next);
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
          showAlert(t('chat.cleared'));
        } catch {
          showAlert(t('errors.generic'));
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
        } catch {
          showAlert(t('errors.generic'));
        }
      },
      { destructive: true, confirmText: t('chat.block') },
    );

  const doUnblock = async () => {
    try {
      await userService.unblock(partnerId);
      setBlocked(false);
      void refreshDetail();
    } catch {
      showAlert(t('errors.generic'));
    }
  };

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
  const items = withDaySeparators(messages);

  // si MA connexion est coupée, je ne peux pas savoir si le partenaire est en
  // ligne -> on n'affiche plus le point vert ni « en ligne » (comme WhatsApp).
  // bloqué -> aucune présence, aucun « vu à … » (dans les deux sens).
  const partnerOnlineEffective = !blocked && online && partnerOnline;
  const subtitle = blocked
    ? ''
    : partnerTyping
      ? t('common.typing')
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
              <Pressable hitSlop={10} onPress={() => setMenuOpen(true)}>
                <Icon name="dots-vertical" size={22} color={c.onHeader} />
              </Pressable>
            </View>
          </>
        }
      />
      {!online ? (
        <View style={[styles.offlineStrip, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="cloud-off-outline" size={14} color={c.textMuted} />
          <Text style={[styles.offlineText, { color: c.textMuted }]}>{t('sync.offline')}</Text>
        </View>
      ) : null}
      <SyncBanner />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <FlatList
            data={items}
            inverted
            keyExtractor={(it) => (it.kind === 'msg' ? it.m.id : it.key)}
            contentContainerStyle={
              items.length === 0
                ? styles.emptyContent
                : { paddingVertical: 10 }
            }
            ListEmptyComponent={
              requestStatus === 'accepted' ? (
                <QuickReplies partnerName={partnerName} onSend={(txt) => void sendQuick(txt)} />
              ) : null
            }
            ListFooterComponent={
              items.length === 0 ? null : (
                <Pressable style={styles.encBanner} onPress={() => setEncOpen(true)}>
                  <Icon name="lock" size={12} color={c.textMuted} />
                  <Text style={[styles.encBannerTxt, { color: c.textMuted }]}>
                    {t('chat.encBanner')}
                  </Text>
                </Pressable>
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
              const prev = items[index + 1]; // liste inversée → suivant = plus ancien
              const grouped =
                prev?.kind === 'msg' && prev.m.sender_id === item.m.sender_id;
              return (
                <MessageBubble
                  message={item.m}
                  mine={item.m.sender_id === myId}
                  grouped={grouped}
                  onLongPress={() => onMessageLongPress(item.m)}
                  onRetry={() => retry(item.m)}
                  onOpenMedia={onOpenMedia}
                  onOpenFile={onOpenFile}
                  onOpenLocation={onOpenLocation}
                />
              );
            }}
          />

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
          ) : requestStatus === 'pending_incoming' ? (
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
              <Text style={{ color: c.textMuted, marginBottom: 10 }}>
                {t('conversations.acceptRequestHint', { name: partnerName })}
              </Text>
              <View style={styles.requestActions}>
                <Button label={t('conversations.decline')} variant="secondary" onPress={decline} style={styles.flex} />
                <View style={{ width: 10 }} />
                <Button label={t('conversations.accept')} onPress={accept} style={styles.flex} />
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
              {picker.recording ? (
                <View style={[styles.recBar, { backgroundColor: c.danger + '18' }]}>
                  <View style={[styles.recDot, { backgroundColor: c.danger }]} />
                  <Text style={[styles.recText, { color: c.danger }]}>
                    {t('chat.recording')} {Math.floor(picker.recordSeconds / 60)}:
                    {String(picker.recordSeconds % 60).padStart(2, '0')}
                  </Text>
                  <Text style={[styles.recHint, { color: c.textMuted }]}>
                    {t('chat.voiceHint')}
                  </Text>
                </View>
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
              <View style={[styles.inputWrap, { backgroundColor: c.surface }]}>
                <Pressable hitSlop={8}>
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
                <Pressable hitSlop={8} onPress={() => setAttachOpen(true)} disabled={picker.recording}>
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
                  onPressIn={() => void onMicPressIn()}
                  onPressOut={() => void onMicPressOut()}
                  delayLongPress={120}
                  style={[
                    styles.sendBtn,
                    {
                      backgroundColor: picker.recording ? c.danger : c.primary,
                      transform: [{ scale: picker.recording ? 1.15 : 1 }],
                    },
                  ]}
                >
                  <Icon name="microphone" size={19} color="#fff" />
                </Pressable>
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
              }
            : null
        }
        onReact={doReact}
        onReply={doReply}
        onCopy={doCopy}
        onEdit={doEditFromSheet}
        onForward={doForward}
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
  offlineStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
  },
  offlineText: { fontSize: 12, fontWeight: '600' },
  dayWrap: { alignItems: 'center', marginVertical: 8 },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
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
  requestActions: { flexDirection: 'row' },
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
});
