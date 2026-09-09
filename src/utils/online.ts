/**
 * Garde-fou « connexion requise » pour les actions qui ne peuvent PAS être
 * mises en file d'attente (création de groupe, rejoindre, membres, appels…).
 *
 * `isOfflineError(e)` reconnaît l'échec réseau produit par `apiClient`
 * (ApiError status 0). `onlineRequiredAlert()` affiche un message clair.
 */
import { showAlert } from '@/components/common';
import { ApiError } from '@/api';
import i18n from '@/i18n';

export function isOfflineError(e: unknown): boolean {
  if (e instanceof ApiError) return e.status === 0;
  const name = (e as { name?: string })?.name;
  const msg = String((e as { message?: string })?.message ?? '');
  return name === 'AbortError' || /network|réseau|internet/i.test(msg);
}

export function onlineRequiredAlert(): void {
  showAlert(i18n.t('sync.onlineRequiredTitle'), i18n.t('sync.onlineRequiredBody'));
}

/**
 * Exécute `fn` ; si l'échec est un problème réseau, affiche « connexion
 * requise » et renvoie `null` au lieu de propager. Sinon relance l'erreur.
 */
export async function withOnline<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (isOfflineError(e)) {
      onlineRequiredAlert();
      return null;
    }
    throw e;
  }
}
