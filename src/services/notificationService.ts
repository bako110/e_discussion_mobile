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

import { notificationRepo } from '@/db/repositories/notificationRepo';

import { getNotifPrefs } from './notificationPrefs';

const CH_CALLS = 'calls_v1';
const CH_MESSAGES = 'messages_v1';

/**
 * Le son et la vibration sont fixés AU NIVEAU DU CANAL sur Android (immuables
 * après création). On prépare donc 4 canaux « messages » — un par combinaison
 * (son, vibreur) — et `displayMessageNotification` choisit celui qui
 * correspond aux préférences de l'utilisateur.
 */
function messageChannelId(sound: boolean, vibrate: boolean): string {
  if (sound && vibrate) return CH_MESSAGES;
  if (sound && !vibrate) return 'messages_novib';
  if (!sound && vibrate) return 'messages_silent';
  return 'messages_quiet';
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
      sound: 'ringtone', // res/raw/ringtone.mp3 (fallback : son système)
      vibration: true,
      // valeurs STRICTEMENT POSITIVES, nombre PAIR (attente/vibration).
      vibrationPattern: [400, 800, 400, 800, 400, 1000],
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
      id: 'messages_novib',
      name: 'Messages (sans vibreur)',
      importance: AndroidImportance.HIGH,
      sound: 'default',
      vibration: false,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: 'messages_silent',
      name: 'Messages (silencieux)',
      importance: AndroidImportance.HIGH,
      vibration: true,
      visibility: AndroidVisibility.PRIVATE,
    },
    {
      id: 'messages_quiet',
      name: 'Messages (discret)',
      importance: AndroidImportance.DEFAULT,
      vibration: false,
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
 *  On ne garde que les URL http(s) ; sinon `undefined`. */
function iconUri(v: string | null | undefined): string | undefined {
  return v && /^https?:\/\//i.test(v) ? v : undefined;
}

// ── Appel entrant ────────────────────────────────────────────────────────
export interface IncomingCallNotifData {
  callId: string;
  callType: 'voice' | 'video';
  callerName: string;
  callerAvatar?: string | null;
}

/** Affiche la sonnerie native plein écran. À appeler sur l'event WS `call.incoming`. */
export async function displayIncomingCall(data: IncomingCallNotifData): Promise<void> {
  // Notifs d'appel désactivées : au premier plan, l'écran d'appel in-app
  // (IncomingCallScreen + sonnerie CallPrefs) suffit — on n'ajoute pas la
  // notif OS. En arrière-plan/app tuée on la garde SINON l'appel est manqué
  // en silence.
  if (!getNotifPrefs().calls && AppState.currentState === 'active') return;

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
      // sonnerie en boucle jusqu'à réponse / rejet / timeout
      loopSound: true,
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
      sound: 'ringtone.caf',
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
        largeIcon: iconUri(d.peerAvatar),
        pressAction: { id: 'open-missed-call', launchActivity: 'default' },
        actions: [{ title: 'Rappeler', pressAction: { id: 'call-back', launchActivity: 'default' } }],
        timestamp: Date.now(),
        showTimestamp: true,
      },
      ios: { sound: undefined },
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
  { title: string; messages: { text: string; time: number; sender: string }[] }
>();

export async function displayMessageNotification(d: MessageNotifData): Promise<void> {
  const prefs = getNotifPrefs();
  if (!prefs.messages) return;

  await ensureNotificationSetup();

  const isGroup = !!d.groupId;
  const line = prefs.preview
    ? d.preview || 'Nouveau message'
    : 'Nouveau message';
  const convKey = isGroup ? `g:${d.groupId}` : `c:${d.conversationId}`;
  const title = isGroup ? d.groupName || d.senderName : d.senderName;

  // fil de la conversation (garde les 6 derniers)
  const th = threads.get(convKey) ?? { title, messages: [] };
  th.title = title;
  th.messages.push({ text: line, time: Date.now(), sender: d.senderName });
  if (th.messages.length > 6) th.messages.splice(0, th.messages.length - 6);
  threads.set(convKey, th);

  const count = th.messages.length;
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
      largeIcon: iconUri(d.senderAvatar),
      style: {
        type: AndroidStyle.MESSAGING,
        // « person » = le destinataire (moi) ; chaque message porte son émetteur.
        person: { id: 'me', name: 'Moi' },
        title: isGroup ? title : undefined,
        messages: th.messages.map((m) => ({
          text: m.text,
          timestamp: m.time,
          person: { name: isGroup ? m.sender : title },
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

/** Recale le badge appli sur le nombre de notifs non lues de l'historique. */
export async function refreshBadge(): Promise<void> {
  try {
    const n = await notificationRepo.unreadCount();
    await notifee.setBadgeCount(n).catch(() => undefined);
  } catch {
    /* noop */
  }
}

// ── Événements (taps sur les actions/notifs) ─────────────────────────────
export type NotifAction =
  | { kind: 'call-accept'; callId: string }
  | { kind: 'call-reject'; callId: string }
  | { kind: 'open-chat'; conversationId: string }
  | { kind: 'open-incoming-call'; callId: string }
  | { kind: 'open-chats' }
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

/** À enregistrer une seule fois, au niveau module (hors composant). */
export function registerBackgroundNotificationHandler(
  handler: (a: NotifAction) => Promise<void>,
): void {
  notifee.onBackgroundEvent(async (event) => {
    const a = toAction(event);
    if (a) await handler(a);
    // pour la sonnerie : si l'utilisateur balaie la notif, on l'annule aussi
    if (event.type === EventType.DISMISSED) {
      await clearIncomingCall();
    }
  });
}
