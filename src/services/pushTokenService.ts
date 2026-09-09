/**
 * Enregistrement du jeton de push natif auprès de NOTRE backend.
 *
 * Le cas app-ouverte / app-en-arrière-plan est déjà couvert par notre
 * WebSocket (sonnerie + notifs de messages via notifee). Le jeton de push
 * ne sert qu'au réveil de l'app COMPLÈTEMENT fermée.
 *
 * On ne dépend PAS de Firebase : si `@react-native-firebase/messaging` n'est
 * pas installé, cette fonction est un no-op silencieux. Le jour où on veut le
 * réveil app-tuée, installer ce module suffit — le reste est déjà câblé.
 */
import { Platform } from 'react-native';

import { apiClient, Endpoints } from '@/api';

type MessagingModule = {
  default: () => {
    requestPermission: () => Promise<number>;
    getToken: () => Promise<string>;
    onTokenRefresh: (cb: (token: string) => void) => () => void;
  };
};

let _messaging: MessagingModule['default'] | null = null;
let _tried = false;

function loadMessaging(): MessagingModule['default'] | null {
  if (_tried) return _messaging;
  _tried = true;
  try {
    // require dynamique : absent du bundle si le module n'est pas installé.

    _messaging = require('@react-native-firebase/messaging').default as MessagingModule['default'];
  } catch {
    _messaging = null;
  }
  return _messaging;
}

async function pushToBackend(token: string): Promise<void> {
  try {
    await apiClient.put(Endpoints.devices.pushToken, {
      token,
      platform: Platform.OS === 'ios' ? 'ios' : 'android',
    });
  } catch {
    /* réessai au prochain lancement */
  }
}

let _refreshUnsub: (() => void) | null = null;

/** À appeler une fois l'utilisateur authentifié. Idempotent. */
export async function registerPushToken(): Promise<void> {
  const messaging = loadMessaging();
  if (!messaging) return; // pas de Firebase -> WebSocket seul (app ouverte/bg)
  try {
    await messaging().requestPermission();
    const token = await messaging().getToken();
    if (token) await pushToBackend(token);
    _refreshUnsub?.();
    _refreshUnsub = messaging().onTokenRefresh((t) => void pushToBackend(t));
  } catch {
    /* silencieux */
  }
}

/** À appeler à la déconnexion. */
export async function unregisterPushToken(): Promise<void> {
  const messaging = loadMessaging();
  _refreshUnsub?.();
  _refreshUnsub = null;
  if (!messaging) return;
  try {
    const token = await messaging().getToken();
    if (token) {
      await apiClient.delete(Endpoints.devices.pushToken, {
        token,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
      });
    }
  } catch {
    /* silencieux */
  }
}
