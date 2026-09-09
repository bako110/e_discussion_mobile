/**
 * Point d'entrée unique pour ChatScreen / messageService — orchestre X3DH,
 * Double Ratchet et le stockage local pour chiffrer/déchiffrer un message
 * texte. Aucune primitive crypto n'est appelée directement en dehors de ce
 * module côté app.
 *
 * Phase 1 : UN appareil actif par compte. Le multi-device réel (fan-out vers
 * plusieurs appareils du destinataire, sync vers ses propres autres
 * appareils) est une phase suivante. Un seul bundle (le premier appareil
 * actif renvoyé par le serveur) est utilisé pour l'instant.
 *
 * Porté depuis stream_mobile — adapté au client HTTP d'E-discussion
 * (`apiClient.*` renvoie directement le JSON, pas `{ data }`).
 */
import { Platform } from 'react-native';

import { apiClient, Endpoints } from '@/api';

import {
  clearX3dhInit,
  deleteOneTimePrekey,
  generateOneTimePrekeys,
  getSignedPrekeyPrivate,
  isSessionConfirmed,
  loadOrCreateDeviceIdentity,
  loadOrCreateSignedPrekey,
  loadSession,
  loadX3dhInit,
  markSessionConfirmed,
  peekOneTimePrekeyPrivate,
  saveSession,
  saveX3dhInit,
  type X3dhInitBlob,
} from './keyStore';
import {
  type EncryptedMessage,
  fromBase64,
  initSessionAsInitiator,
  initSessionAsReceiver,
  ratchetDecrypt,
  ratchetEncrypt,
  type SessionState,
  toBase64,
} from './doubleRatchet';
import { bundleFromApi, type PreKeyBundle, x3dhInitiate, x3dhReceive } from './x3dh';

const OTPK_LOW_WATERMARK = 10;
const OTPK_REFILL_COUNT = 20;

interface KeysCountRow {
  device_id: string;
  remaining_one_time_prekeys: number;
}

let registrationPromise: Promise<void> | null = null;

/** Identifiant stable de CET appareil (persisté dans le Keychain-backed MMKV).
 * Utilisé pour marquer l'appareil courant dans « Appareils liés ». */
export async function getDeviceId(): Promise<string> {
  const identity = await loadOrCreateDeviceIdentity();
  return identity.deviceId;
}

/** À appeler une fois au démarrage (utilisateur authentifié) — garantit que
 * cet appareil a une identité E2EE publiée côté serveur. Idempotent. */
export async function ensureDeviceRegistered(): Promise<void> {
  if (registrationPromise) return registrationPromise;
  registrationPromise = (async () => {
    const identity = await loadOrCreateDeviceIdentity();
    const signedPrekey = await loadOrCreateSignedPrekey(identity);

    let remaining = 0;
    try {
      const rows = await apiClient.get<KeysCountRow[]>(Endpoints.devices.myKeysCount);
      remaining =
        (rows ?? []).find((d) => d.device_id === identity.deviceId)?.remaining_one_time_prekeys ?? 0;
    } catch {
      // premier lancement : pas encore enregistré, on enregistre ci-dessous
    }
    if (remaining > 0) return;

    const oneTimePrekeys = await generateOneTimePrekeys(OTPK_REFILL_COUNT);
    await apiClient.post(Endpoints.devices.registerKeys, {
      device_id: identity.deviceId,
      device_label: Platform.OS === 'ios' ? 'iPhone' : 'Android',
      identity_public_key: toBase64(identity.identityKeyPair.publicKey),
      identity_signing_key: toBase64(identity.identitySigningKeyPair.publicKey),
      signed_prekey_id: signedPrekey.id,
      signed_prekey: signedPrekey.publicKey,
      prekey_signature: signedPrekey.signature,
      registration_id: Math.floor(Math.random() * 0x7fffffff),
      one_time_prekeys: oneTimePrekeys.map((k) => ({ key_id: k.prekey_id, public_key: k.public_key })),
    });
  })();
  return registrationPromise;
}

/** Réapprovisionne le stock d'OTPK côté serveur si bas — best-effort. */
export async function refillOneTimePrekeysIfLow(): Promise<void> {
  try {
    const identity = await loadOrCreateDeviceIdentity();
    const rows = await apiClient.get<KeysCountRow[]>(Endpoints.devices.myKeysCount);
    const mine = (rows ?? []).find((d) => d.device_id === identity.deviceId);
    if (!mine || mine.remaining_one_time_prekeys > OTPK_LOW_WATERMARK) return;

    const oneTimePrekeys = await generateOneTimePrekeys(OTPK_REFILL_COUNT);
    await apiClient.post(Endpoints.devices.addPrekeys, {
      device_id: identity.deviceId,
      one_time_prekeys: oneTimePrekeys.map((k) => ({ key_id: k.prekey_id, public_key: k.public_key })),
    });
  } catch {
    // le prochain démarrage réessaiera
  }
}

export interface EncryptedPayload {
  senderDeviceId: string;
  contentType: 'x3dh_initial' | 'ratchet';
  dhPublicKey: string;
  previousChainLength: number;
  messageNumber: number;
  nonce: string;
  ciphertext: string;
  x3dhEphemeralPublicKey?: string;
  x3dhOneTimePrekeyId?: number | null;
  x3dhSenderIdentityPublicKey?: string;
}

interface BundleRaw {
  device_id: string;
  registration_id: number;
  identity_public_key: string;
  identity_signing_key: string;
  signed_prekey_id: number;
  signed_prekey: string;
  prekey_signature: string;
  one_time_prekey_id: number | null;
  one_time_prekey: string | null;
}

/** Chiffre un message texte pour un destinataire — établit une session X3DH
 * si aucune n'existe encore avec son appareil actif. */
export async function encryptMessageForUser(
  recipientUserId: string,
  plaintext: string,
): Promise<EncryptedPayload> {
  const identity = await loadOrCreateDeviceIdentity();
  const bundles = await apiClient.get<BundleRaw[]>(Endpoints.devices.bundles(recipientUserId));
  if (!bundles || bundles.length === 0) {
    throw new Error("E2EE_NO_DEVICE: le destinataire n'a aucun appareil avec chiffrement activé");
  }
  const bundle: PreKeyBundle = bundleFromApi(bundles[0]!);

  let session = await loadSession(recipientUserId, bundle.deviceId);
  const confirmed = await isSessionConfirmed(recipientUserId, bundle.deviceId);
  let x3dhInfo: X3dhInitBlob | null = null;

  if (!session) {
    // Premiere session avec cet appareil : on l'etablit et on MEMORISE le
    // blob X3DH utilise, pour pouvoir le rejoindre a l'identique ensuite.
    const result = x3dhInitiate(identity.identityKeyPair, bundle);
    session = initSessionAsInitiator(result.sharedSecret, result.ephemeralKeyPair, bundle.signedPrekey);
    x3dhInfo = {
      ephemeralPublicKey: toBase64(result.ephemeralKeyPair.publicKey),
      oneTimePrekeyId: result.usedOneTimePrekeyId,
      senderIdentityPublicKey: toBase64(identity.identityKeyPair.publicKey),
    };
    await saveX3dhInit(recipientUserId, bundle.deviceId, x3dhInfo);
  } else if (!confirmed) {
    // Session existante mais JAMAIS confirmee (le pair ne nous a pas repondu
    // -> a peut-etre rate notre 1er message). On garde LA MEME session (une
    // seule chaine de ratchet) mais on REJOINT le meme blob X3DH : le pair
    // pourra bootstraper depuis n'importe lequel de nos messages (0..N).
    x3dhInfo = await loadX3dhInit(recipientUserId, bundle.deviceId);
  }

  const encrypted: EncryptedMessage = ratchetEncrypt(session, new TextEncoder().encode(plaintext));
  await saveSession(recipientUserId, bundle.deviceId, session);

  return {
    senderDeviceId: identity.deviceId,
    contentType: x3dhInfo ? 'x3dh_initial' : 'ratchet',
    dhPublicKey: toBase64(encrypted.header.dhPublicKey),
    previousChainLength: encrypted.header.previousChainLength,
    messageNumber: encrypted.header.messageNumber,
    nonce: toBase64(encrypted.nonce),
    ciphertext: toBase64(encrypted.ciphertext),
    x3dhEphemeralPublicKey: x3dhInfo?.ephemeralPublicKey,
    x3dhOneTimePrekeyId: x3dhInfo?.oneTimePrekeyId ?? undefined,
    x3dhSenderIdentityPublicKey: x3dhInfo?.senderIdentityPublicKey,
  };
}

/** Déchiffre un message reçu — établit la session côté récepteur si c'est un
 * premier message X3DH. */
export async function decryptMessageFromUser(
  senderUserId: string,
  payload: EncryptedPayload,
): Promise<string> {
  const identity = await loadOrCreateDeviceIdentity();
  let session = await loadSession(senderUserId, payload.senderDeviceId);

  // Un message x3dh_initial porte toujours de quoi (re)construire une session
  // receveur. On l'utilise si on n'a pas de session OU si le dechiffrement
  // avec la session courante echoue (cas : l'initiateur est reparti d'une
  // session neuve car il ne savait pas encore que la sienne etait recue).
  const canBootstrap =
    payload.contentType === 'x3dh_initial' &&
    !!payload.x3dhEphemeralPublicKey &&
    !!payload.x3dhSenderIdentityPublicKey;

  const bootstrap = async (): Promise<SessionState> => {
    const signedPrekeyPair = await getSignedPrekeyPrivate();
    if (!signedPrekeyPair) throw new Error('E2EE_NO_LOCAL_SIGNED_PREKEY');
    // PEEK (pas de suppression) : tant que la session n'est pas confirmee, le
    // meme message X3DH peut etre rejoue et on doit re-deriver le meme secret.
    const otpkPrivate =
      payload.x3dhOneTimePrekeyId != null
        ? await peekOneTimePrekeyPrivate(payload.x3dhOneTimePrekeyId)
        : null;
    const sharedSecret = x3dhReceive(
      identity.identityKeyPair,
      signedPrekeyPair.privateKey,
      fromBase64(payload.x3dhSenderIdentityPublicKey!),
      fromBase64(payload.x3dhEphemeralPublicKey!),
      otpkPrivate?.privateKey ?? null,
    );
    return initSessionAsReceiver(sharedSecret, signedPrekeyPair);
  };

  if (!session) {
    if (!canBootstrap) {
      throw new Error('E2EE_SESSION_MISSING: pas de session et message non exploitable');
    }
    session = await bootstrap();
  }

  const encrypted: EncryptedMessage = {
    header: {
      dhPublicKey: fromBase64(payload.dhPublicKey),
      previousChainLength: payload.previousChainLength,
      messageNumber: payload.messageNumber,
    },
    nonce: fromBase64(payload.nonce),
    ciphertext: fromBase64(payload.ciphertext),
  };

  let plaintextBytes: Uint8Array;
  try {
    plaintextBytes = ratchetDecrypt(session, encrypted);
  } catch (e) {
    // Echec avec la session actuelle : si le message embarque un X3DH initial,
    // on retente avec une session receveur reconstruite a partir de lui.
    if (!canBootstrap) throw e;
    session = await bootstrap();
    plaintextBytes = ratchetDecrypt(session, encrypted);
  }

  await saveSession(senderUserId, payload.senderDeviceId, session);
  // On a reussi a lire un message de ce pair -> notre propre session
  // initiateur vers lui est prouvee : on arrete d'y rejoindre le X3DH, et on
  // peut enfin consommer definitivement l'OTPK utilisee pour ce bootstrap.
  await markSessionConfirmed(senderUserId, payload.senderDeviceId);
  await clearX3dhInit(senderUserId, payload.senderDeviceId);
  if (payload.x3dhOneTimePrekeyId != null) {
    await deleteOneTimePrekey(payload.x3dhOneTimePrekeyId);
  }
  return new TextDecoder().decode(plaintextBytes);
}
