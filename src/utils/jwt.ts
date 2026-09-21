/**
 * Lecture SEULE du claim `exp` d'un JWT — jamais de vérification de
 * signature côté client (le serveur reste la seule source de vérité sur la
 * validité réelle du token). Sert uniquement à planifier un rafraîchissement
 * PROACTIF avant expiration, pour ne jamais laisser une requête heurter un
 * 401 en cours d'usage normal — voir `api/client.ts`.
 */

// `atob` n'est PAS garanti disponible sur Hermes — décodeur base64 manuel,
// aucune dépendance, pour ne pas alourdir le bundle pour une seule fonction.
const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
  const clean = base64.replace(/=+$/, '');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of clean) {
    const val = B64_CHARS.indexOf(ch);
    if (val === -1) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}

/** Renvoie l'horodatage d'expiration du token (ms epoch), ou `null` si le
 * token est malformé / sans claim `exp`. */
export function decodeJwtExpiryMs(token: string): number | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(base64UrlDecode(parts[1]!)) as { exp?: number };
    if (typeof payload.exp !== 'number') return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
