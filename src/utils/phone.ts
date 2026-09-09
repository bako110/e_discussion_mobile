import { COUNTRIES } from '@/utils/countries';

/**
 * Normalise un numéro brut (issu du carnet d'adresses) en E.164 (+33612345678).
 *
 *  - `+33 6 12 34 56 78`  -> `+33612345678`   (déjà international, on nettoie)
 *  - `0033612345678`       -> `+33612345678`   (préfixe 00 -> +)
 *  - `06 12 34 56 78`      -> `+33612345678`   (national -> on préfixe l'indicatif du pays de l'utilisateur, on retire le 0)
 *  - `612345678`           -> `+33612345678`   (sans 0 ni indicatif)
 *
 * `defaultDial` = indicatif (sans +) du pays de l'utilisateur, ex '33', '226'.
 * Renvoie null si le résultat n'a pas une longueur plausible.
 */
export function normalizeToE164(raw: string, defaultDial: string): string | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d+]/g, '');
  if (!s) return null;

  if (s.startsWith('+')) {
    s = '+' + s.slice(1).replace(/\D/g, '');
  } else if (s.startsWith('00')) {
    s = '+' + s.slice(2);
  } else if (s.startsWith('0')) {
    // numéro national : retire le 0, ajoute l'indicatif du pays
    s = `+${defaultDial}${s.slice(1)}`;
  } else {
    // pas de 0, pas de + : soit déjà avec indicatif, soit local sans 0
    // heuristique : si ça commence par l'indicatif du pays, on préfixe juste +
    if (s.startsWith(defaultDial) && s.length > defaultDial.length + 6) {
      s = `+${s}`;
    } else {
      s = `+${defaultDial}${s}`;
    }
  }

  const digits = s.slice(1);
  // E.164 : 8 à 15 chiffres au total
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}

/** Indicatif (sans +) le plus probable d'après le numéro E.164 de l'utilisateur. */
export function dialFromE164(userPhone: string | null | undefined): string {
  const p = (userPhone ?? '').replace(/\D/g, '');
  if (!p) return COUNTRIES[0]!.dial;
  // essaie les indicatifs les plus longs d'abord (evite 1 vs 12x)
  const dials = [...new Set(COUNTRIES.map((c) => c.dial))].sort(
    (a, b) => b.length - a.length,
  );
  for (const d of dials) {
    if (p.startsWith(d)) return d;
  }
  return COUNTRIES[0]!.dial;
}
