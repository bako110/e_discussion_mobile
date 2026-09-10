/**
 * Firebase Cloud Messaging — réveil de l'app COMPLÈTEMENT fermée.
 *
 * Le cas app-ouverte / app-en-arrière-plan est déjà couvert par notre
 * WebSocket (sonnerie + notifs via notifee). FCM ne sert qu'au process tué :
 * le backend envoie un message **data-only** priorité haute, et le handler
 * ci-dessous (enregistré au scope module dans `bootstrap.js`) construit la
 * notif — sonnerie plein écran pour un appel, bulle pour un message.
 *
 * `@react-native-firebase/*` est chargé dynamiquement : si le module n'est
 * pas linké (build sans Firebase), tout ici est un no-op silencieux.
 */
import type { FirebaseMessagingTypes } from '@react-native-firebase/messaging';

import {
  displayIncomingCall,
  displayMessageNotification,
  displayMissedCall,
} from './notificationService';

type MessagingFn = () => FirebaseMessagingTypes.Module;

let _messaging: MessagingFn | null = null;
let _tried = false;

function loadMessaging(): MessagingFn | null {
  if (_tried) return _messaging;
  _tried = true;
  try {
    _messaging = require('@react-native-firebase/messaging').default as MessagingFn;
  } catch {
    _messaging = null;
  }
  return _messaging;
}

function pick(data: Record<string, string | object> | undefined, key: string): string {
  const v = data?.[key];
  return typeof v === 'string' ? v : '';
}

/** Traite un message FCM data-only (foreground OU background/headless). */
export async function handleFcmDataMessage(
  message: FirebaseMessagingTypes.RemoteMessage,
): Promise<void> {
  const data = message.data ?? {};
  const type = pick(data, 'type');

  if (type === 'call.incoming') {
    await displayIncomingCall({
      callId: pick(data, 'call_id'),
      callType: pick(data, 'call_type') === 'video' ? 'video' : 'voice',
      callerName: pick(data, 'caller_name') || pick(data, 'title') || 'Appel entrant',
      callerAvatar: pick(data, 'caller_avatar') || null,
    });
    return;
  }

  if (type === 'call.ended' || type === 'call.cancelled' || type === 'call.missed') {
    await displayMissedCall({
      callId: pick(data, 'call_id'),
      callType: pick(data, 'call_type') === 'video' ? 'video' : 'voice',
      peerId: pick(data, 'caller_id'),
      peerName: pick(data, 'caller_name') || pick(data, 'title') || 'Appel manqué',
      peerAvatar: pick(data, 'caller_avatar') || null,
    });
    return;
  }

  if (type === 'message') {
    const encrypted = pick(data, 'encrypted') === '1';
    await displayMessageNotification({
      conversationId: pick(data, 'conversation_id'),
      senderId: pick(data, 'sender_id'),
      senderName: pick(data, 'sender_name') || pick(data, 'title') || 'Message',
      senderAvatar: pick(data, 'sender_avatar') || null,
      preview: encrypted ? '' : pick(data, 'body'),
      messageId: pick(data, 'message_id'),
    });
    return;
  }
}

/**
 * Enregistre le handler background FCM. À appeler au SCOPE MODULE (bootstrap),
 * jamais dans un composant : c'est ce qui permet le réveil app tuée.
 */
export function registerFcmBackgroundHandler(): void {
  const messaging = loadMessaging();
  if (!messaging) return;
  try {
    messaging().setBackgroundMessageHandler(async (msg) => {
      await handleFcmDataMessage(msg);
    });
  } catch {
    /* module présent mais natif absent : no-op */
  }
}

/**
 * Handlers FOREGROUND (app active) : on laisse le WebSocket faire le gros du
 * travail, mais si un push arrive quand même (course réseau), on l'affiche.
 * À appeler une fois l'app montée. Retourne une fonction de désabonnement.
 */
export function subscribeFcmForeground(): () => void {
  const messaging = loadMessaging();
  if (!messaging) return () => undefined;
  try {
    return messaging().onMessage(async (msg) => {
      await handleFcmDataMessage(msg);
    });
  } catch {
    return () => undefined;
  }
}
