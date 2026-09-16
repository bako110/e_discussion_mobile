/**
 * Sons d'appel Android :
 *  - `start`/`stop`Ringtone : sonnerie d'un appel ENTRANT — une VRAIE
 *    sonnerie de l'appareil (parmi celles installées), + vibration —
 *    toutes deux pilotées par les préférences utilisateur synchronisées
 *    serveur (`useCallPrefs()` : `ringtone`, `vibrate`).
 *  - `start`/`stop`Ringback : tonalité « ça sonne chez l'autre » entendue par
 *    l'APPELANT pendant un appel sortant — fichiers audio embarqués
 *    (`ringback.mp3` normal, `ringback_offline.mp3` si le destinataire n'est
 *    pas joignable/ne répond pas).
 *
 * Nécessaire car le son du CANAL de notification ne joue pas de façon
 * fiable dès que `fullScreenAction` prend le relais pour afficher l'écran
 * d'appel plein écran — beaucoup d'OEM coupent/retardent ce son une fois
 * l'activité affichée. On sonne donc nous-mêmes, indépendamment du système
 * de notification.
 */
import { NativeModules, Platform } from 'react-native';

import type { Ringtone } from '@/types';

interface RingtoneNative {
  start(ringtoneKey: string, vibrate: boolean): Promise<boolean>;
  stop(): Promise<boolean>;
  startRingback(offline: boolean): Promise<boolean>;
  stopRingback(): Promise<boolean>;
}

const native = NativeModules.RingtoneModule as RingtoneNative | undefined;

export async function startRingtone(ringtoneKey: Ringtone = 'default', vibrate = true): Promise<void> {
  if (Platform.OS !== 'android') return;
  if (!native) {
    // module natif absent du build installé (pas de rebuild Gradle après son
    // ajout) — sans ce log, l'appel entrant restait muet sans aucune erreur.
    console.warn('[ringtone] RingtoneModule natif indisponible — rebuild natif requis');
    return;
  }
  try {
    await native.start(ringtoneKey, vibrate);
  } catch (e) {
    console.warn('[ringtone] start() a échoué:', String(e));
  }
}

export async function stopRingtone(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.stop();
  } catch {
    /* déjà arrêtée */
  }
}

/** Tonalité de retour d'appel (appelant) — `offline` pour un son distinct
 * quand l'appelé est injoignable/ne répond pas. */
export async function startRingback(offline = false): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.startRingback(offline);
  } catch {
    /* best-effort */
  }
}

export async function stopRingback(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.stopRingback();
  } catch {
    /* déjà arrêtée */
  }
}
