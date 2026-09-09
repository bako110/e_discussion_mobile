/**
 * X3DH (Extended Triple Diffie-Hellman) — établissement de la toute première
 * session chiffrée entre deux appareils, sans que le destinataire soit en
 * ligne (docs.signal.org/specifications/x3dh). Voir doubleRatchet.ts pour le
 * chiffrement message par message une fois la session établie.
 *
 * Copie identique dans E-discussion (pas de package partagé
 * configuré) — toute correction doit être répercutée dans les deux.
 */
import { dh, hkdfDerive, sign, verify, toBase64, fromBase64, type Bytes, type KeyPair, generateX25519KeyPair } from './primitives';

const X3DH_INFO = 'Ediscussion-E2EE-X3DH-v1';
// 32 octets à 0xFF en préfixe du premier DH — pratique standard X3DH pour
// domain-separation, empêche un attaquant de rejouer une signature Ed25519
// d'ailleurs comme si c'était un accord de clé X3DH valide.
const F = new Uint8Array(32).fill(0xff);

export interface PreKeyBundle {
  deviceId: string;
  // X25519 — utilisée pour les calculs Diffie-Hellman (DH1/DH2 de X3DH).
  identityPublicKey: Bytes;
  // Ed25519 — clé SÉPARÉE (courbe différente, incompatible avec un DH),
  // utilisée UNIQUEMENT pour vérifier prekeySignature. Signal réel dérive
  // les deux d'une seule graine via une conversion birationnelle
  // Montgomery↔Edwards ; ici on garde deux paires distinctes générées
  // ensemble à l'inscription, plus simple et tout aussi correct pour cet
  // usage (aucune des deux clés n'est jamais réutilisée pour l'autre rôle).
  identitySigningKey: Bytes;
  signedPrekeyId: number;
  signedPrekey: Bytes;
  prekeySignature: Bytes;
  registrationId: number;
  oneTimePrekeyId: number | null;
  oneTimePrekey: Bytes | null;
}

export function bundleFromApi(raw: {
  device_id: string; identity_public_key: string; identity_signing_key: string; signed_prekey_id: number;
  signed_prekey: string; prekey_signature: string; registration_id: number;
  one_time_prekey_id: number | null; one_time_prekey: string | null;
}): PreKeyBundle {
  return {
    deviceId: raw.device_id,
    identityPublicKey: fromBase64(raw.identity_public_key),
    identitySigningKey: fromBase64(raw.identity_signing_key),
    signedPrekeyId: raw.signed_prekey_id,
    signedPrekey: fromBase64(raw.signed_prekey),
    prekeySignature: fromBase64(raw.prekey_signature),
    registrationId: raw.registration_id,
    oneTimePrekeyId: raw.one_time_prekey_id,
    oneTimePrekey: raw.one_time_prekey ? fromBase64(raw.one_time_prekey) : null,
  };
}

export interface X3dhInitiatorResult {
  sharedSecret: Bytes;
  ephemeralKeyPair: KeyPair;
  usedOneTimePrekeyId: number | null;
}

/**
 * Côté A (initiateur) — appelé une fois par appareil destinataire, au tout
 * premier message. Vérifie la signature du signed_prekey AVANT tout calcul :
 * un bundle dont la signature ne correspond pas à l'identity_key ne doit
 * jamais être utilisé (signal fort de compromission possible du serveur).
 *
 * La paire éphémère générée ici (`ephemeralKeyPair`) est réutilisée telle
 * quelle comme première paire DH ratchet de A (voir initSessionAsInitiator)
 * — c'est ce qui permet à A de faire un vrai premier tour de ratchet DH dès
 * l'initialisation, avec `bundle.signedPrekey` (public) de B comme dhRemote
 * initial, plutôt que d'improviser une dérivation ad-hoc non symétrique.
 */
export function x3dhInitiate(myIdentityKeyPair: KeyPair, bundle: PreKeyBundle): X3dhInitiatorResult {
  if (!verify(bundle.identitySigningKey, bundle.signedPrekey, bundle.prekeySignature)) {
    throw new Error('SIGNATURE_INVALID: signed_prekey non authentifiée par identity_key — bundle rejeté');
  }

  const ephemeral = generateX25519KeyPair();

  // DH1 = IK_A × SPK_B, DH2 = EK_A × IK_B, DH3 = EK_A × SPK_B, DH4 (si OTPK) = EK_A × OPK_B
  const dh1 = dh(myIdentityKeyPair.privateKey, bundle.signedPrekey);
  const dh2 = dh(ephemeral.privateKey, bundle.identityPublicKey);
  const dh3 = dh(ephemeral.privateKey, bundle.signedPrekey);
  const dh4 = bundle.oneTimePrekey ? dh(ephemeral.privateKey, bundle.oneTimePrekey) : new Uint8Array(0);

  const ikm = concatBytes(F, dh1, dh2, dh3, dh4);
  const sharedSecret = hkdfDerive(ikm, X3DH_INFO, 32);

  return {
    sharedSecret,
    ephemeralKeyPair: ephemeral,
    usedOneTimePrekeyId: bundle.oneTimePrekeyId,
  };
}

/**
 * Côté B (récepteur) — appelé à la réception du tout premier message d'un
 * nouvel appareil A. Reproduit exactement les mêmes DH dans le même ordre
 * pour dériver la même sharedSecret. `myOneTimePrekeyPrivate` doit être
 * retrouvée localement par `usedOneTimePrekeyId` (générée et stockée par B
 * lui-même au moment de l'upload de ses OTPK publiques — jamais transmise).
 */
export function x3dhReceive(
  myIdentityKeyPair: KeyPair,
  mySignedPrekeyPrivate: Bytes,
  theirIdentityPublicKey: Bytes,
  theirEphemeralPublicKey: Bytes,
  myOneTimePrekeyPrivate: Bytes | null,
): Bytes {
  const dh1 = dh(mySignedPrekeyPrivate, theirIdentityPublicKey);
  const dh2 = dh(myIdentityKeyPair.privateKey, theirEphemeralPublicKey);
  const dh3 = dh(mySignedPrekeyPrivate, theirEphemeralPublicKey);
  const dh4 = myOneTimePrekeyPrivate ? dh(myOneTimePrekeyPrivate, theirEphemeralPublicKey) : new Uint8Array(0);

  const ikm = concatBytes(F, dh1, dh2, dh3, dh4);
  return hkdfDerive(ikm, X3DH_INFO, 32);
}

/** Signe un signed_prekey avec la clé d'identité — à l'enregistrement et à
 * chaque rotation périodique (~7j) du signed_prekey. */
export function signPrekey(identityKeyPair: KeyPair, signedPrekeyPublic: Bytes): Bytes {
  return sign(identityKeyPair.privateKey, signedPrekeyPublic);
}

function concatBytes(...arrays: Bytes[]): Bytes {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

export { toBase64, fromBase64 };
