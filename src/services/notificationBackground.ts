/**
 * Handler de notifications en arrière-plan / app fermée (contexte JS headless).
 *
 * DOIT rester autonome : pas d'import de contextes React, de navigation, ni de
 * la Room LiveKit. On se contente de :
 *  - « Refuser » : appeler l'endpoint reject directement + retirer la sonnerie ;
 *  - « Répondre » / tap : stocker l'intention d'appel dans MMKV et laisser
 *    `launchActivity` ouvrir l'app — CallContext lira l'intention au démarrage ;
 *  - balayage de la notif : retirer la sonnerie.
 */
import notifee, { EventType } from '@notifee/react-native';
import { MMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';

import { API_BASE_URL } from '@/utils/constants';
import { Endpoints } from '@/api';
import { INCOMING_CALL_NOTIF_ID } from './notificationService';

const store = new MMKV({ id: 'call-intents' });
const PENDING_KEY = 'pending.accept.callId';

/** L'app relit ceci au démarrage (CallContext) pour accepter automatiquement. */
export function takePendingAcceptCallId(): string | null {
  const v = store.getString(PENDING_KEY) ?? null;
  if (v) store.delete(PENDING_KEY);
  return v;
}

export function setPendingAcceptCallId(callId: string): void {
  store.set(PENDING_KEY, callId);
}

const KEYCHAIN_SERVICE = 'ediscussion-auth-tokens';

async function currentAccessToken(): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!creds || !creds.password) return null;
    return (JSON.parse(creds.password) as { access: string }).access ?? null;
  } catch {
    return null;
  }
}

async function rejectRemote(callId: string): Promise<void> {
  try {
    const token = await currentAccessToken();
    if (!token) return;
    await fetch(`${API_BASE_URL}${Endpoints.calls.reject(callId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch {
    /* le timeout de sonnerie serveur basculera l'appel en "missed" */
  }
}

export function registerBackgroundNotificationHandler(): void {
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    const pressId = detail.pressAction?.id;
    const data = detail.notification?.data ?? {};
    const callId = data.callId ? String(data.callId) : '';

    if (type === EventType.ACTION_PRESS && pressId === 'call-reject' && callId) {
      await rejectRemote(callId);
      await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
      return;
    }

    if (
      (type === EventType.ACTION_PRESS && pressId === 'call-accept') ||
      (type === EventType.PRESS && (pressId === 'incoming-call' || data.kind === 'call'))
    ) {
      if (callId) setPendingAcceptCallId(callId);
      // `launchActivity: 'default'` ouvre l'app ; CallContext prend le relais.
      return;
    }

    if (type === EventType.DISMISSED) {
      await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
    }
  });
}
