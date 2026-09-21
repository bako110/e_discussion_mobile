/**
 * Notifications natives (OS) — appels & messages — pilotées par NOTRE
 * WebSocket auto-hébergé. Aucun cloud push tiers requis pour le cas
 * app-ouverte / app-en-arrière-plan.
 *
 *  - Sonnerie d'appel entrant : notification `IMPORTANCE_HIGH` + son en
 *    boucle + `fullScreenAction` -> réveille l'écran et lance NOTRE
 *    IncomingCallScreen (contrôle total du design côté React Native).
 *  - Messages : notification native par conversation (regroupée), son court.
 *
 * L'écran d'appel lui-même reste 100 % React Native (voir CallOverlay).
 */
import { AppState, Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidStyle,
  AndroidVisibility,
  type Event,
  EventType,
} from '@notifee/react-native';

import { conversationRepo } from '@/db/repositories/conversationRepo';
import { groupRepo } from '@/db/repositories/groupRepo';
import { notificationRepo } from '@/db/repositories/notificationRepo';
import { mediaUrl } from '@/utils/media';

import { getNotifPrefs } from './notificationPrefs';

// v2 : un NotificationChannel Android est IMMUABLE une fois créé (son,
// vibration, importance ne sont plus modifiables par le code après coup —
// seul l'utilisateur peut les changer dans les réglages système). Les
// premières versions de ces canaux ont été créées avec un vibrationPattern
// invalide -> Android a pu les enregistrer sans son. On renomme les IDs
// pour forcer la création de canaux propres ; ne JAMAIS réutiliser ces IDs.
//
// v3 (CH_CALLS) : le canal 'calls_v2' pointait vers `res/raw/ringtone.mp3`,
// supprimé depuis (la sonnerie utilise maintenant le son système par
// défaut) — sur les appareils où ce canal avait déjà été créé, il restait
// figé sur ce fichier qui n'existe plus, Android échouant SILENCIEUSEMENT à
// jouer un son (juste vibreur/notification muette, plus de vraie sonnerie).
//
// v4 (CH_CALLS) : le SON du canal est désormais désactivé (`sound: undefined`,
// `vibration: false`). La vraie sonnerie/vibration vient exclusivement de
// `RingtoneModule` (natif, déclenché dès la réception du push — voir
// `fcm.ts`), qui tourne EN PARALLÈLE de cette notification. Garder aussi le
// son sur le canal faisait sonner les DEUX en même temps, créant un effet de
// notifications/sonneries qui se chevauchent/« bouclent » l'une sur l'autre.
// Cette notif ne sert donc plus qu'au visuel (réveil d'écran, fullScreenAction).
const CH_CALLS = 'calls_v4';
const CH_MESSAGES = 'messages_v2';
const CH_STORIES = 'stories_v2';
const CH_APPOINTMENTS = 'appointments_v1';

/**
 * Le son et la vibration sont fixés AU NIVEAU DU CANAL sur Android (immuables
 * après création). On prépare donc 4 canaux « messages » — un par combinaison
 * (son, vibreur) — et `displayMessageNotification` choisit celui qui
 * correspond aux préférences de l'utilisateur.
 */
function messageChannelId(sound: boolean, vibrate: boolean): string {
  if (sound && vibrate) return CH_MESSAGES;
  if (sound && !vibrate) return 'messages_novib_v2';
  if (!sound && vibrate) return 'messages_silent_v2';
  return 'messages_quiet_v2';
}

/** id fixe pour la notif de sonnerie : permet de l'annuler à la réponse. */
export const INCOMING_CALL_NOTIF_ID = 'incoming-call';

let _channelsReady = false;

/** Crée les canaux Android + demande la permission notifications (idempotent). */
export async function ensureNotificationSetup(): Promise<void> {
  try {
    await notifee.requestPermission();
  } catch {
    /* permission refusée : les notifs seront silencieuses */
  }
  if (_channelsReady || Platform.OS !== 'android') {
    _channelsReady = true;
    return;
  }
  // Chaque canal est créé indépendamment : si l'un échoue (config invalide),
  // il ne doit PAS empêcher les autres — sinon plus aucune notif du tout.
  const channels: Parameters<typeof notifee.createChannel>[0][] = [
    {
      id: CH_CALLS,
      name: 'Appels',
      importance: AndroidImportance.HIGH,
      // PAS de son/vibreur ICI : RingtoneModule (natif) sonne et vibre déjà
      // en parallèle dès la réception du push — voir le commentaire v4
      // ci-dessus. Ce canal ne sert plus qu'à réveiller l'écran
      // (fullScreenAction) et afficher la notification visuelle.
      visibility: AndroidVisibility.PUBLIC,
      bypassDnd: true,
    },
    {
      id: CH_MESSAGES,
      name: 'Messages',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: 'messages_novib_v2',
      name: 'Messages (sans vibreur)',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: false,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: 'messages_silent_v2',
      name: 'Messages (silencieux)',
      importance: AndroidImportance.HIGH,
      vibration: true,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: 'messages_quiet_v2',
      name: 'Messages (discret)',
      importance: AndroidImportance.DEFAULT,
      vibration: false,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: CH_STORIES,
      name: 'Statuts',
      importance: AndroidImportance.DEFAULT,
      sound: 'default',
      vibration: false,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: CH_APPOINTMENTS,
      name: 'Rendez-vous',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: true,
      visibility: AndroidVisibility.PRIVATE,
    },
  ];
  for (const ch of channels) {
    try {
      await notifee.createChannel(ch);
    } catch (e) {
      console.warn(`[notif] createChannel(${ch.id}) a échoué:`, String(e));
    }
  }
  _channelsReady = true;
}

/** notifee refuse une chaîne vide / non-URL pour largeIcon & person.icon.
 * Le backend renvoie souvent un chemin RELATIF (`/media/...`) — sans le
 * résoudre via `mediaUrl()` d'abord, `iconUri` le rejetait systématiquement
 * (jamais `http(s)://`), donc la photo n'apparaissait JAMAIS dans les
 * notifications malgré la valeur transmise. On ne garde que les URL http(s)
 * absolues une fois résolues ; sinon `undefined`. */
function iconUri(v: string | null | undefined): string | undefined {
  const resolved = mediaUrl(v);
  return resolved && /^https?:\/\//i.test(resolved) ? resolved : undefined;
}

// ── Appel entrant ────────────────────────────────────────────────────────
export interface IncomingCallNotifData {
  callId: string;
  callType: 'voice' | 'video';
  callerName: string;
  callerAvatar?: string | null;
}

// Un même appel entrant peut arriver par DEUX chemins quasi simultanés :
// notre WebSocket ET un push FCM data-only (course réseau) — le backend
// envoie systématiquement les deux (`call_service.py` appelle `send_to_user`
// PUIS `push_to_user` sans savoir si le destinataire a déjà un WS ouvert).
// Sans garde, `loopSound: true` relancerait la sonnerie du canal depuis le
// début pour le second appel, créant l'effet de sonnerie qui « boucle »/se
// mélange avec elle-même en plus de la sonnerie native de l'écran d'appel.
let lastIncomingCallId: string | null = null;

/** Affiche l'écran d'appel plein écran (SANS son — canal silencieux depuis
 * v4, voir CH_CALLS). À appeler sur l'event WS `call.incoming`. */
export async function displayIncomingCall(data: IncomingCallNotifData): Promise<void> {
  // Au premier plan, l'écran d'appel in-app (IncomingCallScreen + sonnerie
  // native via RingtoneModule, pilotée par InCallRingtone/CallPrefs) suffit
  // TOUJOURS — on n'ajoute JAMAIS la notif OS ici, quel que soit le réglage
  // "notif appels" : la notif OS ne sert qu'à réveiller l'appareil en
  // arrière-plan/app tuée, là où aucun écran React n'est encore monté.
  if (AppState.currentState === 'active') return;

  // même appel déjà affiché (course WS/FCM) -> ne pas relancer la sonnerie
  if (lastIncomingCallId === data.callId) return;
  lastIncomingCallId = data.callId;

  await ensureNotificationSetup();
  const isVideo = data.callType === 'video';
  await notifee.displayNotification({
    id: INCOMING_CALL_NOTIF_ID,
    title: data.callerName,
    body: isVideo ? 'Appel vidéo entrant' : 'Appel entrant',
    data: { kind: 'call', callId: data.callId, callType: data.callType },
    android: {
      channelId: CH_CALLS,
      category: AndroidCategory.CALL,
      importance: AndroidImportance.HIGH,
      // PAS de son ici (canal silencieux, cf. CH_CALLS v4) : la sonnerie
      // réelle vient de RingtoneModule, déclenché en parallèle par fcm.ts.
      ongoing: true,
      autoCancel: false,
      // réveille l'écran et lance MainActivity -> RootNavigator affiche
      // notre IncomingCallScreen (piloté par CallContext).
      fullScreenAction: { id: 'incoming-call', launchActivity: 'default' },
      pressAction: { id: 'incoming-call', launchActivity: 'default' },
      timestamp: Date.now(),
      showTimestamp: true,
      actions: [
        { title: 'Refuser', pressAction: { id: 'call-reject' } },
        {
          title: 'Répondre',
          pressAction: { id: 'call-accept', launchActivity: 'default' },
        },
      ],
    },
    ios: {
      categoryId: 'incoming-call',
      critical: true,
      // sonnerie du téléphone (réglages système) — pas de fichier custom
      sound: 'default',
      interruptionLevel: 'timeSensitive',
    },
  });

  // entrée d'historique « appel entrant » (mise à jour en « manqué » /
  // « refusé » plus tard si l'appel ne se conclut pas).
  await notificationRepo
    .add({
      id: `call-${data.callId}`,
      kind: 'call',
      title: data.callerName,
      body: data.callType === 'video' ? 'Appel vidéo entrant' : 'Appel entrant',
      callId: data.callId,
      avatarUrl: data.callerAvatar ?? null,
      callResult: 'incoming',
      callType: data.callType,
    })
    .catch(() => undefined);
  void refreshBadge();
}

/** Retire la sonnerie (réponse, rejet, annulation, timeout). */
export async function clearIncomingCall(): Promise<void> {
  lastIncomingCallId = null;
  try {
    await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
  } catch {
    /* déjà retirée */
  }
}

// ── Appel manqué ─────────────────────────────────────────────────────────
export interface MissedCallNotifData {
  callId: string;
  callType: 'voice' | 'video';
  peerId: string;
  peerName: string;
  peerAvatar?: string | null;
  /** true si l'utilisateur a explicitement refusé (pas vraiment « manqué »). */
  rejected?: boolean;
}

/**
 * Notif persistante d'appel manqué + entrée d'historique. À appeler quand un
 * `call.ended`/`call.cancelled` arrive sans qu'on ait décroché (ou sur
 * timeout de sonnerie). Sûre à appeler même app au premier plan : la notif
 * OS est alors omise mais l'historique est écrit.
 */
export async function displayMissedCall(d: MissedCallNotifData): Promise<void> {
  await clearIncomingCall();

  const label = d.rejected
    ? 'Appel refusé'
    : d.callType === 'video'
      ? 'Appel vidéo manqué'
      : 'Appel manqué';

  await notificationRepo
    .add({
      id: `call-${d.callId}`,
      kind: 'call',
      title: d.peerName,
      body: label,
      callId: d.callId,
      peerId: d.peerId || null,
      avatarUrl: d.peerAvatar ?? null,
      callResult: d.rejected ? 'rejected' : 'missed',
      callType: d.callType,
    })
    .catch(() => undefined);
  void refreshBadge();

  const prefs = getNotifPrefs();
  // au premier plan (et notifs d'appel coupées) : historique seul, pas de notif OS
  if (AppState.currentState === 'active' && !prefs.calls) return;

  await ensureNotificationSetup();
  await notifee
    .displayNotification({
      id: `missed-${d.callId}`,
      title: d.peerName,
      body: label,
      data: {
        kind: 'missed-call',
        peerId: d.peerId,
        callType: d.callType,
      },
      android: {
        channelId: messageChannelId(prefs.sound, prefs.vibrate),
        category: AndroidCategory.CALL,
        importance: AndroidImportance.DEFAULT,
        ...(iconUri(d.peerAvatar) ? { largeIcon: iconUri(d.peerAvatar) } : {}),
        pressAction: { id: 'open-missed-call', launchActivity: 'default' },
        actions: [{ title: 'Rappeler', pressAction: { id: 'call-back', launchActivity: 'default' } }],
        timestamp: Date.now(),
        showTimestamp: true,
      },
      ios: { sound: undefined },
    })
    .catch(() => undefined);
}

// ── Statuts (stories) ────────────────────────────────────────────────────
export interface StoryNotifData {
  authorId: string;
  authorName: string;
  authorAvatar?: string | null;
}

/** Affiche une notif discrète « nouveau statut ». À appeler sur l'event WS
 * `story.new` / le push FCM `type: 'story.new'`, si activé dans les réglages. */
export async function displayStoryNotification(d: StoryNotifData): Promise<void> {
  if (!getNotifPrefs().stories) return;

  await ensureNotificationSetup();
  await notifee
    .displayNotification({
      // id stable PAR AUTEUR : plusieurs statuts publiés d'affilée par la
      // même personne ne créent pas une pile de notifs redondantes.
      id: `story-${d.authorId}`,
      title: d.authorName,
      body: 'a publié un nouveau statut',
      data: { kind: 'story', authorId: d.authorId },
      android: {
        channelId: CH_STORIES,
        category: AndroidCategory.SOCIAL,
        importance: AndroidImportance.DEFAULT,
        ...(iconUri(d.authorAvatar) ? { largeIcon: iconUri(d.authorAvatar) } : {}),
        pressAction: { id: 'open-story', launchActivity: 'default' },
        timestamp: Date.now(),
        showTimestamp: true,
      },
      ios: { sound: undefined },
    })
    .catch(() => undefined);
}

// ── Rendez-vous (RDV) ────────────────────────────────────────────────────
export interface AppointmentNotifData {
  appointmentId: string;
  title: string;
  body: string;
}

/** Invitation, réponse (accepté/refusé), annulation ou rappel (24h/1h/heure)
 * d'un rendez-vous — un seul type de notif, le texte varie selon l'event
 * (voir `data.type` côté serveur dans appointment_service.py /
 * appointment_reminders.py, traduit ici en un texte affichable). */
export async function displayAppointmentNotification(d: AppointmentNotifData): Promise<void> {
  await ensureNotificationSetup();
  await notifee
    .displayNotification({
      id: `appt-${d.appointmentId}-${Date.now()}`,
      title: d.title,
      body: d.body,
      data: { kind: 'appointment', appointmentId: d.appointmentId },
      android: {
        channelId: CH_APPOINTMENTS,
        category: AndroidCategory.REMINDER,
        importance: AndroidImportance.HIGH,
        pressAction: { id: 'open-appointment', launchActivity: 'default' },
        timestamp: Date.now(),
        showTimestamp: true,
      },
      ios: { sound: 'default' },
    })
    .catch(() => undefined);
}

// ── Messages ─────────────────────────────────────────────────────────────
export interface MessageNotifData {
  conversationId: string;
  senderId: string;
  senderName: string;
  senderAvatar?: string | null;
  preview: string; // vide si message chiffré
  messageId: string;
  /** conversation de groupe : titre = nom du groupe, ligne = "Nom : texte". */
  groupId?: string | null;
  groupName?: string | null;
}

const GROUP_KEY = 'ediscussion.messages';

/**
 * Fil des derniers messages par conversation, pour le style « MESSAGING »
 * d'Android (bulle de conversation qui montre les N dernières lignes).
 * En mémoire : suffisant tant que le process JS vit ; à froid la notif
 * repart d'une seule ligne, ce qui est acceptable.
 */
const threads = new Map<
  string,
  {
    title: string;
    messages: { text: string; time: number; sender: string; senderIcon?: string }[];
  }
>();

// Un même message peut arriver par DEUX chemins presque simultanés : notre
// WebSocket (foreground) ET un push FCM data-only (course réseau, cf.
// `subscribeFcmForeground`) — sans garde, la ligne du message serait ajoutée
// deux fois au fil de la conversation. On retient les derniers messageId déjà
// affichés (mémoire courte, suffisante le temps d'une course réseau).
const recentlyShown = new Set<string>();
function alreadyShown(messageId: string): boolean {
  if (!messageId) return false; // pas d'id -> pas de dédup possible, on affiche
  if (recentlyShown.has(messageId)) return true;
  recentlyShown.add(messageId);
  // fenêtre large mais bornée : évite une fuite mémoire si l'app tourne des jours
  if (recentlyShown.size > 200) {
    const first = recentlyShown.values().next().value;
    if (first) recentlyShown.delete(first);
  }
  return false;
}

export async function displayMessageNotification(d: MessageNotifData): Promise<void> {
  const prefs = getNotifPrefs();
  if (!prefs.messages) return;
  if (alreadyShown(d.messageId)) return;

  await ensureNotificationSetup();

  const isGroup = !!d.groupId;
  const line = prefs.preview
    ? d.preview || 'Nouveau message'
    : 'Nouveau message';
  const convKey = isGroup ? `g:${d.groupId}` : `c:${d.conversationId}`;
  const title = isGroup ? d.groupName || d.senderName : d.senderName;
  // Icône de CETTE ligne (l'émetteur du message qui vient d'arriver) — sert
  // à la fois de `largeIcon` général de la notif et de photo affichée à côté
  // de la ligne dans le fil `MESSAGING`, façon WhatsApp.
  const largeIcon = iconUri(d.senderAvatar);

  // fil de la conversation (garde les 6 derniers)
  const th = threads.get(convKey) ?? { title, messages: [] };
  th.title = title;
  th.messages.push({
    text: line,
    time: Date.now(),
    sender: d.senderName,
    senderIcon: largeIcon,
  });
  if (th.messages.length > 6) th.messages.splice(0, th.messages.length - 6);
  threads.set(convKey, th);

  const count = th.messages.length;

  // Notification complète (bulle « MESSAGING » façon appli de messagerie),
  // avec repli sur une version SIMPLE si l'affichage avancé échoue — vécu
  // en pratique sur un push FCM reçu à froid (process tout juste relancé en
  // headless) : `displayNotification` a planté avec « largeIcon expected a
  // React Native ImageResource value or a valid string URL » même avec
  // `largeIcon: undefined` explicite, ce qui empêchait TOUTE notification de
  // s'afficher — mieux vaut un affichage dégradé qu'aucun affichage du tout.
  try {
    await notifee.displayNotification({
      id: `msg-${d.conversationId}`,
      title,
      body: isGroup ? `${d.senderName} : ${line}` : line,
      subtitle: count > 1 ? `${count} messages` : undefined,
      data: {
        kind: 'message',
        conversationId: d.conversationId,
        ...(d.groupId ? { groupId: d.groupId } : {}),
      },
      android: {
        channelId: messageChannelId(prefs.sound, prefs.vibrate),
        category: AndroidCategory.MESSAGE,
        importance:
          prefs.sound || prefs.vibrate
            ? AndroidImportance.HIGH
            : AndroidImportance.DEFAULT,
        pressAction: { id: 'open-chat', launchActivity: 'default' },
        groupId: GROUP_KEY,
        // clé OMISE (pas juste `undefined`) si pas d'avatar valide.
        ...(largeIcon ? { largeIcon } : {}),
        style: {
          type: AndroidStyle.MESSAGING,
          // « person » = le destinataire (moi) ; chaque message porte son émetteur.
          person: { id: 'me', name: 'Moi' },
          // clé OMISE (pas juste `undefined`) hors groupe — notifee rejette
          // `title: undefined` avec « MessagingStyle: 'title' expected a
          // string value », ce qui faisait planter TOUTE notification de
          // message 1-à-1 (seuls les groupes fournissaient un vrai titre).
          ...(isGroup ? { title } : {}),
          messages: th.messages.map((m) => ({
            text: m.text,
            timestamp: m.time,
            // clé `icon` OMISE (pas juste `undefined`) si pas d'avatar valide
            // pour ce message précis — même piège que `largeIcon`.
            person: {
              name: isGroup ? m.sender : title,
              ...(m.senderIcon ? { icon: m.senderIcon } : {}),
            },
          })),
          group: isGroup,
        },
        timestamp: Date.now(),
        showTimestamp: true,
        onlyAlertOnce: false,
      },
      ios: {
        threadId: d.conversationId,
        sound: prefs.sound ? 'default' : undefined,
      },
    });
  } catch (e) {
    console.warn('[notif] displayNotification avancé a échoué, repli simple:', String(e));
    await notifee
      .displayNotification({
        id: `msg-${d.conversationId}`,
        title,
        body: isGroup ? `${d.senderName} : ${line}` : line,
        data: {
          kind: 'message',
          conversationId: d.conversationId,
          ...(d.groupId ? { groupId: d.groupId } : {}),
        },
        android: {
          channelId: messageChannelId(prefs.sound, prefs.vibrate),
          category: AndroidCategory.MESSAGE,
          importance:
            prefs.sound || prefs.vibrate
              ? AndroidImportance.HIGH
              : AndroidImportance.DEFAULT,
          pressAction: { id: 'open-chat', launchActivity: 'default' },
          groupId: GROUP_KEY,
        },
        ios: {
          threadId: d.conversationId,
          sound: prefs.sound ? 'default' : undefined,
        },
      })
      .catch((e2) =>
        console.warn('[notif] displayNotification repli simple a AUSSI échoué:', String(e2)),
      );
  }

  // notif de résumé (regroupe les conversations sous une seule tête sur Android)
  await notifee
    .displayNotification({
      id: 'msg-summary',
      title: 'Messages',
      body: 'Nouveaux messages',
      android: {
        channelId: messageChannelId(prefs.sound, prefs.vibrate),
        groupId: GROUP_KEY,
        groupSummary: true,
        onlyAlertOnce: true,
        pressAction: { id: 'open-chats', launchActivity: 'default' },
      },
    })
    .catch(() => undefined);

  // historique local + badge
  await notificationRepo
    .add({
      id: `m-${d.messageId || `${d.conversationId}-${Date.now()}`}`,
      kind: 'message',
      title,
      body: isGroup ? `${d.senderName} : ${line}` : line,
      conversationId: d.conversationId,
      groupId: d.groupId ?? null,
      peerId: d.senderId || null,
      avatarUrl: d.senderAvatar ?? null,
    })
    .catch(() => undefined);
  void refreshBadge();
}

export async function clearConversationNotification(conversationId: string): Promise<void> {
  threads.delete(`c:${conversationId}`);
  try {
    await notifee.cancelNotification(`msg-${conversationId}`);
  } catch {
    /* rien à annuler */
  }
  // plus aucune notif enfant -> retire le résumé
  try {
    const shown = await notifee.getDisplayedNotifications();
    const stillChildren = shown.some(
      (n) => n.id?.startsWith('msg-') && n.id !== 'msg-summary',
    );
    if (!stillChildren) await notifee.cancelNotification('msg-summary');
  } catch {
    /* noop */
  }
  void refreshBadge();
}

export async function clearGroupNotification(groupId: string, conversationId: string): Promise<void> {
  threads.delete(`g:${groupId}`);
  await clearConversationNotification(conversationId);
}

// Abonnés à « le total de non-lus vient de changer » (badge de l'onglet
// Discussions dans TabNavigator, etc.) — sans ça, un `markRead()` local
// (aucun event WebSocket associé) ne redéclenchait la relecture du badge
// dans les écrans abonnés seulement aux events WS : le nombre restait figé
// à l'écran après avoir lu les messages, alors que la DB était bien à jour.
const unreadListeners = new Set<() => void>();
export function onUnreadChanged(fn: () => void): () => void {
  unreadListeners.add(fn);
  return () => unreadListeners.delete(fn);
}
function emitUnreadChanged(): void {
  for (const cb of unreadListeners) {
    try {
      cb();
    } catch {
      /* un abonné ne casse pas les autres */
    }
  }
}

/**
 * Recale le badge de l'icône de l'app (écran d'accueil) sur le VRAI total de
 * messages non lus — conversations 1-1 + groupes/chaînes — façon WhatsApp,
 * plutôt que sur l'historique de notifications (qui peut diverger : une
 * notif marquée lue dans l'historique ne veut pas dire la conversation est
 * lue, et inversement). Reste à jour même app fermée/en arrière-plan tant
 * que ce code tourne (appelé après chaque écriture pertinente en base).
 * Notifie aussi `onUnreadChanged` pour que les badges en mémoire (barre
 * d'onglets) se recalculent immédiatement, sans attendre un event WS.
 */
export async function refreshBadge(): Promise<void> {
  try {
    const [convs, groups] = await Promise.all([conversationRepo.list(), groupRepo.list()]);
    const n =
      convs.reduce((sum, c) => sum + (c.unread_count || 0), 0) +
      groups.reduce((sum, g) => sum + (g.unread_count || 0), 0);
    await notifee.setBadgeCount(n).catch(() => undefined);
  } catch {
    /* noop */
  } finally {
    emitUnreadChanged();
  }
}

// ── Événements (taps sur les actions/notifs) ─────────────────────────────
export type NotifAction =
  | { kind: 'call-accept'; callId: string }
  | { kind: 'call-reject'; callId: string }
  | { kind: 'open-chat'; conversationId: string }
  | { kind: 'open-incoming-call'; callId: string }
  | { kind: 'open-chats' }
  | { kind: 'open-story'; authorId: string }
  | { kind: 'call-back'; peerId: string; callType: 'voice' | 'video' };

function toAction(event: Event): NotifAction | null {
  const { type, detail } = event;
  const pressId = detail.pressAction?.id;
  const data = detail.notification?.data ?? {};
  if (type === EventType.ACTION_PRESS || type === EventType.PRESS) {
    if (pressId === 'call-accept') {
      return { kind: 'call-accept', callId: String(data.callId) };
    }
    if (pressId === 'call-reject') {
      return { kind: 'call-reject', callId: String(data.callId) };
    }
    if (pressId === 'incoming-call' || data.kind === 'call') {
      return { kind: 'open-incoming-call', callId: String(data.callId) };
    }
    if (pressId === 'call-back' && data.peerId) {
      return {
        kind: 'call-back',
        peerId: String(data.peerId),
        callType: data.callType === 'video' ? 'video' : 'voice',
      };
    }
    if (pressId === 'open-missed-call' || data.kind === 'missed-call') {
      return { kind: 'open-chats' };
    }
    if (pressId === 'open-chats') {
      return { kind: 'open-chats' };
    }
    if (pressId === 'open-story' || data.kind === 'story') {
      return { kind: 'open-story', authorId: String(data.authorId ?? '') };
    }
    if (data.kind === 'message') {
      return { kind: 'open-chat', conversationId: String(data.conversationId) };
    }
  }
  return null;
}

/** À brancher au niveau app (foreground). Retourne la fonction de désabonnement. */
export function onNotificationAction(handler: (a: NotifAction) => void): () => void {
  return notifee.onForegroundEvent((event) => {
    const a = toAction(event);
    if (a) handler(a);
  });
}

// NB : le VRAI handler `notifee.onBackgroundEvent` (app tuée/arrière-plan)
// vit dans `./notificationBackground.ts` (enregistré une seule fois au
// scope module par `src/bootstrap.js`). Une fonction du même nom existait
// ici en double, jamais appelée — supprimée pour éviter qu'un futur appel
// écrase silencieusement le vrai handler (notifee n'accepte qu'un seul
// callback `onBackgroundEvent` global).
