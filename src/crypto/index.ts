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
  resetLocalE2EE,
  type EncryptedPayload,
} from './sessionManager';

export {
  decryptFile,
  encryptFile,
  FileTooLargeError,
  FILE_MAX_SIZE_BYTES,
} from './fileCrypto';

export { toBase64, fromBase64 } from './primitives';
