/**
 * Stockage local persistant des clés et sessions E2EE — jamais transmis au
 * serveur, jamais lisible en clair sur le disque de l'appareil.
 *
 * Deux couches :
 *  - react-native-keychain (Keychain iOS / Keystore Android, protection
 *    matérielle) : stocke uniquement la CLÉ DE CHIFFREMENT MMKV elle-même
 *    (un secret de 256 bits), jamais les clés E2EE directement.
 *  - MMKV chiffré (avec cette clé) : stocke l'identité de l'appareil, les
 *    signed/one-time prekeys privées, et l'état de chaque session Double
 *    Ratchet (une par appareil distant).
 *
 * Une instance MMKV séparée de `utils/storage.ts` (qui n'est pas chiffrée) —
 * ne jamais migrer ce module vers le storage général de l'app.
 */
import { MMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';
import { randomBytes, randomId, toBase64, fromBase64, generateX25519KeyPair, type KeyPair } from './primitives';
import { generateEd25519KeyPair, sign as ed25519Sign } from './primitives';
import { signPrekey } from './x3dh';
import { serializeSession, deserializeSession, type SessionState, type SerializedSessionState } from './doubleRatchet';

const KEYCHAIN_SERVICE = 'ediscussion-e2ee-mmkv-key';
const MMKV_ID = 'ediscussion-e2ee-storage';

let mmkvInstance: MMKV | null = null;

/** Récupère (ou crée au premier lancement) la clé de chiffrement MMKV,
 * elle-même protégée par le Keychain/Keystore matériel de l'appareil. */
async function getOrCreateEncryptionKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (existing && existing.password) return existing.password;

  const key = toBase64(randomBytes(32));
  await Keychain.setGenericPassword('e2ee', key, {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function getMmkv() {
  if (mmkvInstance) return mmkvInstance;
  const encryptionKey = await getOrCreateEncryptionKey();
  mmkvInstance = new MMKV({ id: MMKV_ID, encryptionKey });
  return mmkvInstance;
}

// ── Identité de l'appareil ───────────────────────────────────────────────────

export interface DeviceIdentity {
  deviceId: string;
  identityKeyPair: KeyPair;       // X25519 — pour les DH
  identitySigningKeyPair: KeyPair; // Ed25519 — pour signer le signed_prekey
}

interface SerializedIdentity {
  deviceId: string;
  identityPublicKey: string; identityPrivateKey: string;
  identitySigningPublicKey: string; identitySigningPrivateKey: string;
}

const IDENTITY_KEY = 'identity';

function generateDeviceId(): string {
  // UUID v4 minimal, suffisant ici (pas besoin de la lib uuid complète) —
  // stable tant que l'app n'est pas désinstallée (persisté dans le Keychain-
  // backed MMKV, jamais régénéré après la première fois).
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Charge l'identité existante ou en génère une nouvelle (premier lancement
 * de l'app, ou après désinstallation/reset — dans ce cas tout l'historique
 * chiffré précédent devient définitivement indéchiffrable sur cet appareil,
 * par design : aucune sauvegarde côté serveur n'est possible). */
export async function loadOrCreateDeviceIdentity(): Promise<DeviceIdentity> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(IDENTITY_KEY);
  if (raw) {
    const s: SerializedIdentity = JSON.parse(raw);
    return {
      deviceId: s.deviceId,
      identityKeyPair: { publicKey: fromBase64(s.identityPublicKey), privateKey: fromBase64(s.identityPrivateKey) },
      identitySigningKeyPair: { publicKey: fromBase64(s.identitySigningPublicKey), privateKey: fromBase64(s.identitySigningPrivateKey) },
    };
  }

  const identity: DeviceIdentity = {
    deviceId: generateDeviceId(),
    identityKeyPair: generateX25519KeyPair(),
    identitySigningKeyPair: generateEd25519KeyPair(),
  };
  const serialized: SerializedIdentity = {
    deviceId: identity.deviceId,
    identityPublicKey: toBase64(identity.identityKeyPair.publicKey),
    identityPrivateKey: toBase64(identity.identityKeyPair.privateKey),
    identitySigningPublicKey: toBase64(identity.identitySigningKeyPair.publicKey),
    identitySigningPrivateKey: toBase64(identity.identitySigningKeyPair.privateKey),
  };
  mmkv.set(IDENTITY_KEY, JSON.stringify(serialized));
  return identity;
}

// ── Signed prekey + one-time prekeys (parties privées) ───────────────────────

const SIGNED_PREKEY_KEY = 'signed_prekey';
const OTPK_PREFIX = 'otpk:';

export async function loadOrCreateSignedPrekey(identity: DeviceIdentity): Promise<{ id: number; publicKey: string; signature: string }> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(SIGNED_PREKEY_KEY);
  if (raw) {
    const s = JSON.parse(raw);
    return { id: s.id, publicKey: s.publicKey, signature: s.signature };
  }
  const keyPair = generateX25519KeyPair();
  const id = Math.floor(Date.now() / 1000); // suffisant comme identifiant unique de rotation
  const signature = toBase64(signPrekey(identity.identitySigningKeyPair, keyPair.publicKey));
  const publicKey = toBase64(keyPair.publicKey);
  mmkv.set(SIGNED_PREKEY_KEY, JSON.stringify({
    id, signature, publicKey, privateKey: toBase64(keyPair.privateKey),
  }));
  return { id, publicKey, signature };
}

export async function getSignedPrekeyPrivate(): Promise<KeyPair | null> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(SIGNED_PREKEY_KEY);
  if (!raw) return null;
  const s = JSON.parse(raw);
  return { publicKey: fromBase64(s.publicKey), privateKey: fromBase64(s.privateKey) };
}

/** Génère un lot de nouvelles OTPK (à envoyer au serveur via POST
 * /devices/keys ou /devices/keys/one-time-prekeys), stocke les parties
 * privées localement pour pouvoir répondre à un X3DH entrant plus tard. */
export async function generateOneTimePrekeys(count: number): Promise<{ prekey_id: number; public_key: string }[]> {
  const mmkv = await getMmkv();
  const out: { prekey_id: number; public_key: string }[] = [];
  // randomId() reste dans la plage int32 (colonne Postgres `prekey_id`,
  // Date.now() la dépasse largement — bug corrigé ici) ; Set pour garantir
  // l'unicité au sein du lot malgré le tirage aléatoire.
  const usedIds = new Set<number>();
  for (let i = 0; i < count; i++) {
    const keyPair = generateX25519KeyPair();
    let id = randomId();
    while (usedIds.has(id)) id = randomId();
    usedIds.add(id);
    mmkv.set(`${OTPK_PREFIX}${id}`, JSON.stringify({
      id, publicKey: toBase64(keyPair.publicKey), privateKey: toBase64(keyPair.privateKey),
    }));
    out.push({ prekey_id: id, public_key: toBase64(keyPair.publicKey) });
  }
  return out;
}

/** Retrouve la clé privée d'une OTPK par son id (fournie par le serveur dans
 * le payload x3dh_initial reçu) — et la supprime immédiatement après lecture
 * (usage unique, jamais réutilisable, cf. forward secrecy du 1er message). */
export async function consumeOneTimePrekeyPrivate(prekeyId: number): Promise<KeyPair | null> {
  const mmkv = await getMmkv();
  const key = `${OTPK_PREFIX}${prekeyId}`;
  const raw = mmkv.getString(key);
  if (!raw) return null;
  mmkv.delete(key);
  const s = JSON.parse(raw);
  return { publicKey: fromBase64(s.publicKey), privateKey: fromBase64(s.privateKey) };
}

/** Lit une OTPK privée SANS la supprimer. Utilisé pendant le bootstrap de
 * session côté récepteur : tant que la session n'est pas confirmée, un
 * message X3DH peut être rejoué (le pair ré-attache le même blob) et on doit
 * pouvoir re-dériver le même secret. La suppression réelle a lieu via
 * `deleteOneTimePrekey` une fois la session confirmée. */
export async function peekOneTimePrekeyPrivate(prekeyId: number): Promise<KeyPair | null> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(`${OTPK_PREFIX}${prekeyId}`);
  if (!raw) return null;
  const s = JSON.parse(raw);
  return { publicKey: fromBase64(s.publicKey), privateKey: fromBase64(s.privateKey) };
}

export async function deleteOneTimePrekey(prekeyId: number): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.delete(`${OTPK_PREFIX}${prekeyId}`);
}

// ── Sessions Double Ratchet (une par appareil distant) ───────────────────────

function sessionKey(peerUserId: string, peerDeviceId: string): string {
  return `session:${peerUserId}:${peerDeviceId}`;
}

export async function loadSession(peerUserId: string, peerDeviceId: string): Promise<SessionState | null> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(sessionKey(peerUserId, peerDeviceId));
  if (!raw) return null;
  try {
    return deserializeSession(JSON.parse(raw) as SerializedSessionState);
  } catch { return null; }
}

export async function saveSession(peerUserId: string, peerDeviceId: string, state: SessionState): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.set(sessionKey(peerUserId, peerDeviceId), JSON.stringify(serializeSession(state)));
}

export async function deleteSession(peerUserId: string, peerDeviceId: string): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.delete(sessionKey(peerUserId, peerDeviceId));
}

// ── Blob d'amorce X3DH (cote initiateur) ────────────────────────────────────
// On memorise les valeurs X3DH EXACTES utilisees pour creer la session
// initiateur, afin de pouvoir les REJOINDRE a l'identique sur chaque message
// tant que le pair ne nous a pas repondu (preuve qu'il a bien recu l'amorce).
// Rejoindre les MEMES valeurs (et non en regenerer) garde une seule session /
// une seule chaine de ratchet : le pair peut alors bootstraper depuis
// n'importe lequel de nos messages (0..N) via les skipped keys.
export interface X3dhInitBlob {
  ephemeralPublicKey: string;
  oneTimePrekeyId: number | null;
  senderIdentityPublicKey: string;
}

function x3dhKey(peerUserId: string, peerDeviceId: string): string {
  return `x3dh_init:${peerUserId}:${peerDeviceId}`;
}

export async function loadX3dhInit(peerUserId: string, peerDeviceId: string): Promise<X3dhInitBlob | null> {
  const mmkv = await getMmkv();
  const raw = mmkv.getString(x3dhKey(peerUserId, peerDeviceId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as X3dhInitBlob;
  } catch {
    return null;
  }
}

export async function saveX3dhInit(
  peerUserId: string,
  peerDeviceId: string,
  blob: X3dhInitBlob,
): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.set(x3dhKey(peerUserId, peerDeviceId), JSON.stringify(blob));
}

export async function clearX3dhInit(peerUserId: string, peerDeviceId: string): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.delete(x3dhKey(peerUserId, peerDeviceId));
}

// ── Confirmation de session ─────────────────────────────────────────────────
// Une session cote INITIATEUR n'est "confirmee" que lorsqu'on a reussi a
// dechiffrer un message venant du pair (preuve qu'il a bien recu notre X3DH
// initial). Tant que ce n'est pas confirme, on RENVOIE les infos X3DH sur
// CHAQUE message sortant : si le pair a rate notre 1er message (WS coupe,
// app fermee), il peut quand meme etablir la session depuis n'importe lequel.
const CONFIRMED_PREFIX = 'session_confirmed:';

export async function isSessionConfirmed(peerUserId: string, peerDeviceId: string): Promise<boolean> {
  const mmkv = await getMmkv();
  return mmkv.getBoolean(`${CONFIRMED_PREFIX}${peerUserId}:${peerDeviceId}`) === true;
}

export async function markSessionConfirmed(peerUserId: string, peerDeviceId: string): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.set(`${CONFIRMED_PREFIX}${peerUserId}:${peerDeviceId}`, true);
}

export async function clearSessionConfirmed(peerUserId: string, peerDeviceId: string): Promise<void> {
  const mmkv = await getMmkv();
  mmkv.delete(`${CONFIRMED_PREFIX}${peerUserId}:${peerDeviceId}`);
}

export { ed25519Sign };
