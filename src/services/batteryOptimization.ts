/**
 * Exemption Doze/optimisation batterie (Android uniquement).
 *
 * Sans cette exemption, certains OEM (Transsion/Infinix/Tecno notamment)
 * coupent silencieusement la connexion FCM en arrière-plan : le push part
 * bien du serveur (accepté par Firebase) mais n'arrive JAMAIS sur
 * l'appareil — aucune erreur visible, juste un silence total. WhatsApp/
 * Telegram/Signal demandent tous cette même exemption au premier lancement
 * ou dans leurs réglages, pour la même raison.
 */
import { NativeModules, Platform } from 'react-native';

interface BatteryOptNative {
  isIgnoringBatteryOptimizations(): Promise<boolean>;
  requestIgnoreBatteryOptimizations(): Promise<boolean>;
  openAppSettings(): Promise<boolean>;
  openNotificationChannelSettings(channelId: string): Promise<boolean>;
  canUseFullScreenIntent(): Promise<boolean>;
  openFullScreenIntentSettings(): Promise<boolean>;
}

const native = NativeModules.BatteryOptModule as BatteryOptNative | undefined;

/** `true` si l'app est déjà exemptée. Toujours `true` hors Android (rien à faire). */
export async function isIgnoringBatteryOptimizations(): Promise<boolean> {
  if (Platform.OS !== 'android' || !native) return true;
  try {
    return await native.isIgnoringBatteryOptimizations();
  } catch {
    return false;
  }
}

/** Ouvre la boîte de dialogue système demandant l'exemption. No-op hors Android. */
export async function requestIgnoreBatteryOptimizations(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.requestIgnoreBatteryOptimizations();
  } catch {
    /* l'utilisateur peut avoir annulé, ou l'OEM bloque l'intent — pas grave */
  }
}

/** Filet de secours : écran des paramètres de l'app (certains OEM exigent un
 * réglage constructeur supplémentaire introuvable via l'intent standard). */
export async function openAppSettings(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.openAppSettings();
  } catch {
    /* no-op */
  }
}

/** Ouvre directement les réglages système du canal de notification donné.
 * Utilisé pour permettre à l'utilisateur de masquer la notif permanente du
 * service de maintien en arrière-plan (canal `keepalive_v1`) : elle ne peut
 * pas être masquée par du code (Android l'exige tant que le service tourne),
 * seul ce panneau système le permet. */
export async function openNotificationChannelSettings(channelId: string): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.openNotificationChannelSettings(channelId);
  } catch {
    /* no-op */
  }
}

/**
 * `true` si l'app peut afficher une notification PLEIN ÉCRAN — indispensable
 * pour qu'un appel entrant sonne façon "vrai appel" (écran + sonnerie qui se
 * lancent seuls) plutôt que de rester une simple notification cliquable.
 * Depuis Android 14, cette permission n'est plus accordée automatiquement :
 * sans elle, `fullScreenAction` est dégradé silencieusement par l'OS.
 * Toujours `true` hors Android ou avant Android 14 (rien à demander).
 */
export async function canUseFullScreenIntent(): Promise<boolean> {
  if (Platform.OS !== 'android' || !native) return true;
  try {
    return await native.canUseFullScreenIntent();
  } catch {
    return true;
  }
}

/** Ouvre l'écran système où activer la notification plein écran pour l'app
 * (Android 14+ uniquement). No-op ailleurs. */
export async function openFullScreenIntentSettings(): Promise<void> {
  if (Platform.OS !== 'android' || !native) return;
  try {
    await native.openFullScreenIntentSettings();
  } catch {
    /* no-op */
  }
}
