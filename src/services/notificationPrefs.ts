/**
 * Lecture des préférences de notification (écran Réglages → Notifications).
 *
 * Stockées en MMKV sous `notif.*` par `ToggleRow` (valeur `'1'`/`'0'`).
 * Ce module est le SEUL point de lecture — utilisable depuis le contexte
 * foreground (`MessageNotifications`) comme depuis le handler background
 * (`notificationBackground`), donc aucune dépendance React ici.
 */
import { storage } from '@/utils/storage';

export interface NotifPrefs {
  /** Afficher une notif OS pour les nouveaux messages. */
  messages: boolean;
  /** Afficher une notif OS pour les appels entrants (l'écran d'appel reste affiché). */
  calls: boolean;
  /** Afficher l'aperçu (corps) du message dans la notif. */
  preview: boolean;
  /** Jouer un son à la notification. */
  sound: boolean;
  /** Faire vibrer à la notification. */
  vibrate: boolean;
}

const DEFAULTS: NotifPrefs = {
  messages: true,
  calls: true,
  preview: true,
  sound: true,
  vibrate: true,
};

function read(key: string, fallback: boolean): boolean {
  try {
    const v = storage.getString(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

export function getNotifPrefs(): NotifPrefs {
  return {
    messages: read('notif.messages', DEFAULTS.messages),
    calls: read('notif.calls', DEFAULTS.calls),
    preview: read('notif.preview', DEFAULTS.preview),
    sound: read('notif.sound', DEFAULTS.sound),
    vibrate: read('notif.vibrate', DEFAULTS.vibrate),
  };
}
