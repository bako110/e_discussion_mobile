/**
 * Octets aléatoires + UUID v4, robustes sur Hermes.
 *
 * Priorité :
 *  1. `crypto.getRandomValues` (fourni par react-native-get-random-values,
 *     importé en tête de index.js) — cryptographiquement sûr.
 *  2. Repli `Math.random` — UNIQUEMENT si le polyfill n'est pas encore chargé
 *     (ne devrait jamais arriver en prod). Suffisant pour un identifiant de
 *     corrélation local (client_id), PAS pour du matériel cryptographique.
 */
export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  const g = globalThis as unknown as {
    crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
  };
  if (g.crypto?.getRandomValues) {
    g.crypto.getRandomValues(out);
    return out;
  }
  for (let i = 0; i < len; i++) out[i] = Math.floor(Math.random() * 256);
  return out;
}

export function uuidv4(): string {
  const b = randomBytes(16);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
