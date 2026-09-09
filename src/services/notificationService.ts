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
import { Platform } from 'react-native';
import notifee, {
  AndroidCategory,
  AndroidImportance,
  AndroidVisibility,
  type Event,
  EventType,
} from '@notifee/react-native';

const CH_CALLS = 'calls_v1';
const CH_MESSAGES = 'messages_v1';

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
  await notifee.createChannel({
    id: CH_CALLS,
    name: 'Appels',
    importance: AndroidImportance.HIGH,
    sound: 'ringtone', // res/raw/ringtone.mp3 (fallback : son système)
    vibration: true,
    vibrationPattern: [0, 1000, 800, 1000, 800, 1000],
    visibility: AndroidVisibility.PUBLIC,
    bypassDnd: true,
  });
  await notifee.createChannel({
    id: CH_MESSAGES,
    name: 'Messages',
    importance: AndroidImportance.HIGH,
    sound: 'default',
    vibration: true,
    visibility: AndroidVisibility.PRIVATE,
  });
  _channelsReady = true;
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
}

/** Retire la sonnerie (réponse, rejet, annulation, timeout). */
export async function clearIncomingCall(): Promise<void> {
  try {
    await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
  } catch {
    /* déjà retirée */
  }
}

// ── Messages ─────────────────────────────────────────────────────────────
export interface MessageNotifData {
  conversationId: string;
  senderId: string;
  senderName: string;
  preview: string; // vide si message chiffré
  messageId: string;
}

export async function displayMessageNotification(d: MessageNotifData): Promise<void> {
  await ensureNotificationSetup();
  await notifee.displayNotification({
    // une notif par conversation : le nouveau message remplace le précédent
    id: `msg-${d.conversationId}`,
    title: d.senderName,
    body: d.preview || 'Nouveau message',
    data: { kind: 'message', conversationId: d.conversationId },
    android: {
      channelId: CH_MESSAGES,
      category: AndroidCategory.MESSAGE,
      importance: AndroidImportance.HIGH,
      pressAction: { id: 'open-chat', launchActivity: 'default' },
      groupId: 'messages',
      timestamp: Date.now(),
      showTimestamp: true,
    },
    ios: { threadId: d.conversationId, sound: 'default' },
  });
}

export async function clearConversationNotification(conversationId: string): Promise<void> {
  try {
    await notifee.cancelNotification(`msg-${conversationId}`);
  } catch {
    /* rien à annuler */
  }
}

// ── Événements (taps sur les actions/notifs) ─────────────────────────────
export type NotifAction =
  | { kind: 'call-accept'; callId: string }
  | { kind: 'call-reject'; callId: string }
  | { kind: 'open-chat'; conversationId: string }
  | { kind: 'open-incoming-call'; callId: string };

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
