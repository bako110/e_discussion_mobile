/**
 * Double Ratchet — chiffrement message par message une fois une session X3DH
 * établie (docs.signal.org/specifications/doubleratchet). Implémentation
 * suivant strictement la spec publique : à chaque message envoyé, la chaîne
 * d'envoi avance (symmetric-key ratchet) ; à chaque nouvelle clé publique DH
 * reçue de l'autre pair, un nouveau tour de ratchet Diffie-Hellman a lieu
 * (dérive une nouvelle root key + de nouvelles chaînes).
 *
 * Propriétés recherchées :
 *  - Forward secrecy : compromettre une chain key ne permet pas de déchiffrer
 *    les messages précédents (chaque clé de message est immédiatement effacée
 *    après usage, chaque chain key est à sens unique — dérivée via HMAC, pas
 *    inversible).
 *  - Post-compromise security : un nouveau tour de ratchet DH "guérit" une
 *    session même après compromission d'une chain key (le nouvel échange DH
 *    introduit de l'aléa frais que l'attaquant ne connaît pas).
 *
 * Copie identique dans E-discussion (pas de package partagé
 * configuré) — toute correction doit être répercutée dans les deux.
 */
import {
  dh, hkdfDerive, aeadEncrypt, aeadDecrypt, generateX25519KeyPair,
  toBase64, fromBase64, type Bytes, type KeyPair,
} from './primitives';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

const RATCHET_INFO = 'Ediscussion-E2EE-Ratchet-v1';
const MESSAGE_KEY_SEED = new Uint8Array([0x01]);
const CHAIN_KEY_SEED = new Uint8Array([0x02]);

// Purge des clés de message sautées après ce plafond — protège contre un
// pair malveillant qui enverrait des headers avec des `n` énormes pour faire
// exploser le stockage local (DoS mémoire). Un utilisateur normal ne perd
// jamais autant de messages consécutifs dans une seule chaîne.
const MAX_SKIP = 1000;

export interface SkippedKey { dhPublicKey: string; n: number; messageKey: Bytes }

export interface RatchetHeader {
  dhPublicKey: Bytes;   // clé DH publique courante de l'expéditeur
  previousChainLength: number; // longueur de la chaîne d'envoi précédente (PN)
  messageNumber: number; // index dans la chaîne d'envoi courante (N)
}

export interface SessionState {
  dhSelf: KeyPair | null;       // notre paire DH ratchet courante
  dhRemote: Bytes | null;       // dernière clé publique DH reçue de l'autre pair
  rootKey: Bytes;
  chainKeySend: Bytes | null;
  chainKeyRecv: Bytes | null;
  nSend: number;                // nb de messages envoyés dans la chaîne courante
  nRecv: number;                // nb de messages reçus dans la chaîne courante
  previousChainLength: number;  // longueur de la dernière chaîne d'envoi avant le dernier tour DH
  skippedKeys: SkippedKey[];    // clés de messages reçus hors-ordre, pas encore consommées
}

/** Sérialisation pour stockage local (jamais transmise au serveur). */
export interface SerializedSessionState {
  dhSelf: { publicKey: string; privateKey: string } | null;
  dhRemote: string | null;
  rootKey: string;
  chainKeySend: string | null;
  chainKeyRecv: string | null;
  nSend: number;
  nRecv: number;
  previousChainLength: number;
  skippedKeys: { dhPublicKey: string; n: number; messageKey: string }[];
}

export function serializeSession(s: SessionState): SerializedSessionState {
  return {
    dhSelf: s.dhSelf ? { publicKey: toBase64(s.dhSelf.publicKey), privateKey: toBase64(s.dhSelf.privateKey) } : null,
    dhRemote: s.dhRemote ? toBase64(s.dhRemote) : null,
    rootKey: toBase64(s.rootKey),
    chainKeySend: s.chainKeySend ? toBase64(s.chainKeySend) : null,
    chainKeyRecv: s.chainKeyRecv ? toBase64(s.chainKeyRecv) : null,
    nSend: s.nSend,
    nRecv: s.nRecv,
    previousChainLength: s.previousChainLength,
    skippedKeys: s.skippedKeys.map(k => ({ dhPublicKey: k.dhPublicKey, n: k.n, messageKey: toBase64(k.messageKey) })),
  };
}

export function deserializeSession(s: SerializedSessionState): SessionState {
  return {
    dhSelf: s.dhSelf ? { publicKey: fromBase64(s.dhSelf.publicKey), privateKey: fromBase64(s.dhSelf.privateKey) } : null,
    dhRemote: s.dhRemote ? fromBase64(s.dhRemote) : null,
    rootKey: fromBase64(s.rootKey),
    chainKeySend: s.chainKeySend ? fromBase64(s.chainKeySend) : null,
    chainKeyRecv: s.chainKeyRecv ? fromBase64(s.chainKeyRecv) : null,
    nSend: s.nSend,
    nRecv: s.nRecv,
    previousChainLength: s.previousChainLength,
    skippedKeys: s.skippedKeys.map(k => ({ dhPublicKey: k.dhPublicKey, n: k.n, messageKey: fromBase64(k.messageKey) })),
  };
}

// ── Dérivation de chaîne (KDF_CK / KDF_RK, spec Signal) ──────────────────────

function kdfRootChain(rootKey: Bytes, dhOutput: Bytes): { rootKey: Bytes; chainKey: Bytes } {
  const output = hkdfDerive(dhOutput, RATCHET_INFO, 64, rootKey);
  return { rootKey: output.slice(0, 32), chainKey: output.slice(32, 64) };
}

function kdfChainStep(chainKey: Bytes): { chainKey: Bytes; messageKey: Bytes } {
  return {
    chainKey: hmac(sha256, chainKey, CHAIN_KEY_SEED),
    messageKey: hmac(sha256, chainKey, MESSAGE_KEY_SEED),
  };
}

// ── Initialisation ────────────────────────────────────────────────────────────

/**
 * Côté initiateur X3DH (A). Contrairement à une init "vide", A connaît déjà
 * le signed_prekey PUBLIC de B (reçu dans le bundle) — ça permet de faire un
 * vrai premier tour de ratchet DH dès l'initialisation, avec la paire
 * éphémère X3DH réutilisée comme première paire DH ratchet de A (exactement
 * ce que fait Signal : "the sending chain key is derived using the shared
 * secret and Bob's signed prekey as if it were a normal DH ratchet step").
 * Sans ce premier tour, la toute première chaîne d'envoi de A ne serait
 * dérivable par B qu'en devinant une convention ad-hoc non spécifiée — bug
 * classique d'implémentation maison du Double Ratchet.
 */
export function initSessionAsInitiator(
  sharedSecretFromX3dh: Bytes,
  ephemeralKeyPair: KeyPair,
  theirSignedPrekeyPublic: Bytes,
): SessionState {
  const state: SessionState = {
    dhSelf: ephemeralKeyPair, dhRemote: theirSignedPrekeyPublic,
    rootKey: sharedSecretFromX3dh,
    chainKeySend: null, chainKeyRecv: null,
    nSend: 0, nRecv: 0, previousChainLength: 0,
    skippedKeys: [],
  };
  const dhOut = dh(ephemeralKeyPair.privateKey, theirSignedPrekeyPublic);
  const { rootKey, chainKey } = kdfRootChain(state.rootKey, dhOut);
  state.rootKey = rootKey;
  state.chainKeySend = chainKey;
  return state;
}

/**
 * Côté récepteur X3DH (B). B connaît déjà sa propre paire signed_prekey
 * (dhSelf) mais ignore encore la paire éphémère de A tant qu'aucun message
 * n'est arrivé — chainKeyRecv reste null jusqu'au premier ratchetDecrypt,
 * qui déclenchera le tour DH symétrique à celui fait ci-dessus par A.
 */
export function initSessionAsReceiver(sharedSecretFromX3dh: Bytes, mySignedPrekeyPair: KeyPair): SessionState {
  return {
    dhSelf: mySignedPrekeyPair, dhRemote: null,
    rootKey: sharedSecretFromX3dh,
    chainKeySend: null, chainKeyRecv: null,
    nSend: 0, nRecv: 0, previousChainLength: 0,
    skippedKeys: [],
  };
}

// ── Envoi ─────────────────────────────────────────────────────────────────────

export interface EncryptedMessage {
  header: RatchetHeader;
  nonce: Bytes;
  ciphertext: Bytes;
}

export function ratchetEncrypt(state: SessionState, plaintext: Bytes, associatedData?: Bytes): EncryptedMessage {
  // chainKeySend est déjà dérivée par initSessionAsInitiator (A) ou par un
  // tour de ratchet DH déclenché par un ratchetDecrypt précédent (B, ou A
  // après avoir reçu une réponse). Un receiver (B) qui tenterait d'envoyer
  // AVANT d'avoir rien reçu de A est un usage incorrect du protocole — B n'a
  // par construction aucun dhRemote avant ce premier message entrant.
  if (!state.dhSelf || !state.chainKeySend) {
    throw new Error('RATCHET_STATE_INVALID: aucune chaîne d\'envoi disponible — un receiver X3DH ne peut pas envoyer avant d\'avoir reçu un premier message');
  }

  const { chainKey, messageKey } = kdfChainStep(state.chainKeySend);
  state.chainKeySend = chainKey;

  const header: RatchetHeader = {
    dhPublicKey: state.dhSelf.publicKey,
    previousChainLength: state.previousChainLength,
    messageNumber: state.nSend,
  };
  state.nSend += 1;

  const { nonce, ciphertext } = aeadEncrypt(messageKey, plaintext, associatedData);
  return { header, nonce, ciphertext };
}

// ── Réception ─────────────────────────────────────────────────────────────────

export function ratchetDecrypt(state: SessionState, msg: EncryptedMessage, associatedData?: Bytes): Bytes {
  const headerDhB64 = toBase64(msg.header.dhPublicKey);

  // 1. Clé de message déjà dérivée pour un message reçu hors-ordre plus tôt ?
  const skippedIdx = state.skippedKeys.findIndex(k => k.dhPublicKey === headerDhB64 && k.n === msg.header.messageNumber);
  if (skippedIdx !== -1) {
    const { messageKey } = state.skippedKeys[skippedIdx];
    state.skippedKeys.splice(skippedIdx, 1);
    return aeadDecrypt(messageKey, msg.nonce, msg.ciphertext, associatedData);
  }

  // 2. Nouvelle clé publique DH distante -> tour de ratchet DH complet.
  const isNewRatchetKey = !state.dhRemote || toBase64(state.dhRemote) !== headerDhB64;
  if (isNewRatchetKey) {
    if (state.chainKeyRecv) {
      skipMessageKeys(state, msg.header.previousChainLength);
    }
    dhRatchetStep(state, msg.header.dhPublicKey);
  }

  skipMessageKeys(state, msg.header.messageNumber);

  if (!state.chainKeyRecv) throw new Error('RATCHET_STATE_INVALID: aucune chaîne de réception disponible');
  const { chainKey, messageKey } = kdfChainStep(state.chainKeyRecv);
  state.chainKeyRecv = chainKey;
  state.nRecv += 1;

  return aeadDecrypt(messageKey, msg.nonce, msg.ciphertext, associatedData);
}

/** Dérive et met en réserve toutes les clés de message entre nRecv et
 * `until` (exclu) — nécessaire pour déchiffrer un message reçu hors-ordre
 * plus tard sans perdre les messages intermédiaires. */
function skipMessageKeys(state: SessionState, until: number): void {
  if (until - state.nRecv > MAX_SKIP) {
    throw new Error('TOO_MANY_SKIPPED_MESSAGES: rejet — protection anti-DoS mémoire');
  }
  if (!state.chainKeyRecv) return;
  const dhRemoteB64 = state.dhRemote ? toBase64(state.dhRemote) : '';
  while (state.nRecv < until) {
    const { chainKey, messageKey } = kdfChainStep(state.chainKeyRecv);
    state.skippedKeys.push({ dhPublicKey: dhRemoteB64, n: state.nRecv, messageKey });
    state.chainKeyRecv = chainKey;
    state.nRecv += 1;
  }
}

function dhRatchetStep(state: SessionState, theirNewDhPublicKey: Bytes): void {
  state.previousChainLength = state.nSend;
  state.nSend = 0;
  state.nRecv = 0;
  state.dhRemote = theirNewDhPublicKey;

  // Tour de réception : DH(dhSelf_actuelle, dhRemote_nouvelle)
  if (state.dhSelf) {
    const dhOut = dh(state.dhSelf.privateKey, state.dhRemote);
    const { rootKey, chainKey } = kdfRootChain(state.rootKey, dhOut);
    state.rootKey = rootKey;
    state.chainKeyRecv = chainKey;
  }

  // Tour d'envoi : nouvelle paire DH locale, puis DH(dhSelf_nouvelle, dhRemote_nouvelle)
  state.dhSelf = generateX25519KeyPair();
  const dhOut2 = dh(state.dhSelf.privateKey, state.dhRemote);
  const { rootKey: rootKey2, chainKey: chainKeySend2 } = kdfRootChain(state.rootKey, dhOut2);
  state.rootKey = rootKey2;
  state.chainKeySend = chainKeySend2;
}

export { toBase64, fromBase64 };
