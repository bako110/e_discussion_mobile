/**
 * Primitives cryptographiques pour le chiffrement de bout en bout (E2EE) —
 * Signal Protocol (X3DH + Double Ratchet), voir crypto/x3dh.ts et
 * crypto/doubleRatchet.ts.
 *
 * @noble/* plutôt que libsodium-wrappers : Hermes (moteur JS par défaut de
 * React Native depuis 0.70+) n'implémente PAS WebAssembly — libsodium-wrappers
 * (bindings WASM) ne peut donc pas fonctionner côté mobile RN, seulement dans
 * un navigateur. Les libs @noble/* sont du TypeScript pur compilé, sans WASM
 * ni binding natif : comportement identique sur Hermes (mobile) et navigateur
 * (web), zéro étape de build native à maintenir.
 *
 * Ce fichier est volontairement identique mot pour mot entre stream_mobile et
 * stream_web (pas de monorepo/package partagé configuré) — toute correction
 * doit être répercutée dans les deux copies.
 */
import { x25519, ed25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { randomBytes } from '@noble/hashes/utils.js';

export type Bytes = Uint8Array;

// ── Encodage ─────────────────────────────────────────────────────────────────
// Toutes les clés transitent en base64 sur le fil JSON (backend agnostique,
// ne les interprète jamais) — encodage/décodage centralisés ici.

// btoa/atob existent nativement dans le navigateur (window.btoa) et sous
// Hermes/RN (global.btoa, polyfillé par la plateforme) ; Buffer est le
// repli Node-only (tests Jest). On ne suppose la présence d'aucun objet
// global spécifique à une seule plateforme.
type B64Env = { btoa?: (s: string) => string; atob?: (s: string) => string };
const env: B64Env = (typeof globalThis !== 'undefined' ? globalThis : {}) as B64Env;

export function toBase64(bytes: Bytes): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  if (env.btoa) return env.btoa(binary);
  // Repli Node-only (tests Jest, jamais atteint en navigateur ni sous Hermes).
  return (globalThis as any).Buffer.from(bytes).toString('base64');
}

export function fromBase64(b64: string): Bytes {
  if (env.atob) {
    const binary = env.atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array((globalThis as any).Buffer.from(b64, 'base64'));
}

// ── Génération de clés ───────────────────────────────────────────────────────

export interface KeyPair { publicKey: Bytes; privateKey: Bytes }

/** Paire X25519 — accord de clé (Diffie-Hellman), utilisée pour l'identité,
 * les signed/one-time prekeys, et chaque étape du ratchet DH. */
export function generateX25519KeyPair(): KeyPair {
  const { secretKey, publicKey } = x25519.keygen();
  return { publicKey, privateKey: secretKey };
}

/** Paire Ed25519 — signature, utilisée uniquement pour signer le
 * signed_prekey avec la clé d'identité (preuve d'authenticité du bundle). */
export function generateEd25519KeyPair(): KeyPair {
  const { secretKey, publicKey } = ed25519.keygen();
  return { publicKey, privateKey: secretKey };
}

export function sign(privateKey: Bytes, message: Bytes): Bytes {
  return ed25519.sign(message, privateKey);
}

export function verify(publicKey: Bytes, message: Bytes, signature: Bytes): boolean {
  try { return ed25519.verify(signature, message, publicKey); } catch { return false; }
}

export function dh(privateKey: Bytes, publicKey: Bytes): Bytes {
  return x25519.getSharedSecret(privateKey, publicKey);
}

// ── Dérivation de clés (HKDF-SHA256) ─────────────────────────────────────────

export function hkdfDerive(inputKeyMaterial: Bytes, info: string, length: number, salt?: Bytes): Bytes {
  return hkdf(sha256, inputKeyMaterial, salt ?? new Uint8Array(32), new TextEncoder().encode(info), length);
}

// ── Chiffrement authentifié (XChaCha20-Poly1305) ─────────────────────────────
// Nonce 24 octets (XChaCha, pas ChaCha20 standard 12 octets) : assez grand
// pour être généré aléatoirement à chaque message sans risque de collision
// pratique, pas besoin de compteur synchronisé entre les deux pairs.

export function aeadEncrypt(key: Bytes, plaintext: Bytes, associatedData?: Bytes): { nonce: Bytes; ciphertext: Bytes } {
  const nonce = randomBytes(24);
  const cipher = xchacha20poly1305(key, nonce, associatedData);
  return { nonce, ciphertext: cipher.encrypt(plaintext) };
}

export function aeadDecrypt(key: Bytes, nonce: Bytes, ciphertext: Bytes, associatedData?: Bytes): Bytes {
  const cipher = xchacha20poly1305(key, nonce, associatedData);
  return cipher.decrypt(ciphertext); // lève si le tag d'authentification est invalide
}

export function randomId(): number {
  // Identifiants de prekey — 31 bits, jamais 0 (0 réservé/sentinelle possible côté serveur).
  return 1 + Math.floor(Math.random() * (2 ** 31 - 2));
}

export { randomBytes };
