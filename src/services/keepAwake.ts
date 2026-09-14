/**
 * Empêche l'écran de s'éteindre pendant un appel ou un enregistrement/
 * lecture vocal (Android uniquement — iOS gère `isIdleTimerDisabled` via
 * `expo-keep-awake`/API native équivalente, hors scope ici : pas d'appels
 * vidéo iOS actifs pour l'instant côté produit).
 *
 * SANS ça, la mise en veille automatique coupe l'écran en pleine
 * conversation/enregistrement : l'appel/l'audio continue (rien n'est
 * interrompu côté LiveKit/enregistreur), mais l'utilisateur se retrouve
 * avec un écran noir et doit rallumer manuellement pour raccrocher/revoir
 * les contrôles.
 *
 * `activateKeepAwake`/`deactivateKeepAwake` sont idempotents — toujours les
 * appairer (activer à l'entrée en appel/enregistrement, désactiver à la
 * sortie, y compris sur les chemins d'erreur) pour ne jamais laisser
 * l'écran forcé allumé en dehors de ces contextes précis.
 */
import { NativeModules, Platform } from 'react-native';

interface KeepAwakeNative {
  activate(): Promise<boolean>;
  deactivate(): Promise<boolean>;
}

const native = NativeModules.KeepAwakeModule as KeepAwakeNative | undefined;

export async function activateKeepAwake(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.activate();
  } catch {
    /* pas bloquant : au pire l'écran peut s'éteindre */
  }
}

export async function deactivateKeepAwake(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.deactivate();
  } catch {
    /* ignore */
  }
}
