/**
 * API E2EE publique — le reste de l'app n'importe QUE depuis ici.
 *
 * Signal Protocol (X3DH + Double Ratchet), primitives @noble/* en TypeScript
 * pur (pas de WASM : compatible Hermes). Porté depuis stream_mobile.
 */
export {
  decryptMessageFromUser,
  encryptMessageForUser,
  ensureDeviceRegistered,
  getDeviceId,
  refillOneTimePrekeysIfLow,
  resetLocalE2EE,
  type EncryptedPayload,
} from './sessionManager';
