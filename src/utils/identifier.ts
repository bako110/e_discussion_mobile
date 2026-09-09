/** Heuristique e-mail vs téléphone côté client (le backend re-valide). */
export function looksLikeEmail(value: string): boolean {
  return /\S+@\S+\.\S+/.test(value.trim());
}

export function looksLikePhone(value: string): boolean {
  const v = value.trim().replace(/[\s\-().]/g, '');
  return v.startsWith('+') ? /^\+\d{6,15}$/.test(v) : /^\d{6,15}$/.test(v);
}
