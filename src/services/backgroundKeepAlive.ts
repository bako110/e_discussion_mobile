/**
 * Foreground service Android — garde le processus JS vivant en arrière-plan
 * (façon WhatsApp/Telegram), avec une notification discrète permanente et
 * silencieuse. Complète l'exemption batterie (`batteryOptimization.ts`) :
 * même accordée, certains OEM (Transsion/Infinix/Tecno) tuent quand même le
 * process au bout de quelques secondes sans un vrai foreground service —
 * celui-ci a une priorité bien plus haute dans le gestionnaire mémoire/énergie.
 *
 * Démarré UNE SEULE FOIS dès l'authentification (voir `RootNavigator.tsx`),
 * PAS lors du passage en arrière-plan : Android restreint fortement
 * `startForegroundService()` quand il est appelé alors que l'app est DÉJÀ en
 * arrière-plan — le service peut alors ne jamais atteindre `onStartCommand`,
 * ce qui fait planter TOUT LE PROCESS avec
 * `ForegroundServiceDidNotStartInTimeException` au bout du délai imparti
 * (observé en prod : crash reproductible à chaque appel entrant reçu en
 * arrière-plan). Démarrer pendant que l'app est au premier plan (juste après
 * le login) évite cette restriction — le service est déjà vivant quand l'app
 * passe ensuite en arrière-plan.
 *
 * IMPORTANT — idempotence : la sérialisation ci-dessous protège contre tout
 * appel redondant (double montage du composant, StrictMode, etc.) — un
 * `start()`/`stop()` ne démarre qu'une fois le précédent terminé, et ignore
 * un appel qui ne changerait pas l'état courant.
 */
import { NativeModules, Platform } from 'react-native';

interface KeepAliveNative {
  start(): Promise<boolean>;
  stop(): Promise<boolean>;
}

const native = NativeModules.BackgroundKeepAliveModule as KeepAliveNative | undefined;

let running = false;
// sérialise les appels : un start()/stop() ne démarre qu'une fois le
// précédent terminé, pour ne jamais chevaucher deux appels natifs.
let pending: Promise<void> = Promise.resolve();

export function startBackgroundKeepAlive(): Promise<void> {
  pending = pending.then(async () => {
    if (Platform.OS !== 'android' || !native || running) return;
    running = true;
    try {
      await native.start();
    } catch {
      // certains OEM restreignent le démarrage de foreground service depuis
      // l'arrière-plan (Android 12+) -> best-effort, ne doit jamais planter l'app.
      running = false;
    }
  });
  return pending;
}

export function stopBackgroundKeepAlive(): Promise<void> {
  pending = pending.then(async () => {
    if (Platform.OS !== 'android' || !native || !running) return;
    running = false;
    try {
      await native.stop();
    } catch {
      /* déjà arrêté, ou jamais démarré */
    }
  });
  return pending;
}
