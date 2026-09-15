/**
 * Décide quand proposer la notation post-appel (qualité de l'appel + note de
 * l'app) — pas à chaque appel : un cooldown de quelques heures s'applique
 * après CHAQUE affichage de l'invite, qu'elle ait été répondue ou fermée.
 */
import { storage } from '@/utils/storage';

const K_LAST_SHOWN = 'callRating.lastShownAt';
const COOLDOWN_MS = 6 * 3600 * 1000; // 6h

/** true si l'invite peut être proposée maintenant (jamais montrée, ou
 * cooldown écoulé depuis le dernier affichage). */
export function canShowCallRatingPrompt(): boolean {
  const last = storage.getNumber(K_LAST_SHOWN);
  if (!last) return true;
  return Date.now() - last > COOLDOWN_MS;
}

/** À appeler dès que l'invite est affichée — peu importe la réponse de
 * l'utilisateur (note envoyée ou modal fermée sans répondre). */
export function markCallRatingPromptShown(): void {
  storage.set(K_LAST_SHOWN, Date.now());
}
