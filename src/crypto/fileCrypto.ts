/**
 * Chiffrement E2EE des PIÈCES JOINTES (image/vidéo/fichier/vocal), en
 * complément du texte (voir sessionManager.ts). Le fichier n'est jamais
 * envoyé en clair au serveur : on le chiffre localement AVANT l'upload avec
 * une clé de fichier symétrique aléatoire, puis on transmet cette clé au
 * destinataire via le canal Signal existant (`encryptMessageForUser`), comme
 * si c'était un message texte contenant la clé en base64.
 *
 * Format sur disque du fichier chiffré : 24 octets de nonce (XChaCha20)
 * suivis directement du ciphertext, le tout réencodé en base64. Ce format
 * auto-suffisant (nonce + ciphertext concaténés) évite un fichier de
 * métadonnées séparé à faire suivre — un seul blob à uploader/télécharger,
 * exactement comme le serveur en manipule déjà un aujourd'hui (opaque, il ne
 * voit toujours qu'un fichier binaire).
 */
import ReactNativeBlobUtil from 'react-native-blob-util';

import { aeadDecrypt, aeadEncrypt, fromBase64, randomBytes, toBase64 } from './primitives';

// Au-delà, lire tout le fichier en base64 en mémoire (RN ne streame pas le
// chiffrement AEAD) ferait exploser la RAM d'un appareil mobile — on refuse
// proprement plutôt que de risquer un crash silencieux.
const MAX_FILE_SIZE = 80 * 1024 * 1024;
const NONCE_LEN = 24;

// Dossier dédié, séparé du cache média persistant (`mediaCache.ts`) : ces
// fichiers ne sont que des blobs chiffrés TEMPORAIRES en transit vers
// l'upload, jamais destinés à être relus après coup.
const UPLOAD_DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/e2ee-upload`;
let dirReady: Promise<void> | null = null;

function ensureUploadDir(): Promise<void> {
  if (!dirReady) {
    dirReady = (async () => {
      if (!(await ReactNativeBlobUtil.fs.isDir(UPLOAD_DIR))) {
        await ReactNativeBlobUtil.fs.mkdir(UPLOAD_DIR);
      }
    })();
  }
  return dirReady;
}

function stripFilePrefix(uri: string): string {
  return uri.startsWith('file://') ? uri.slice(7) : uri;
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export class FileTooLargeError extends Error {
  constructor(sizeBytes: number) {
    super(`FILE_TOO_LARGE_FOR_E2EE: ${sizeBytes} octets (max ${MAX_FILE_SIZE})`);
    this.name = 'FileTooLargeError';
  }
}

/**
 * Chiffre un fichier local et écrit le résultat dans un fichier temporaire
 * prêt à uploader. La clé de fichier n'est JAMAIS écrite sur disque — elle ne
 * vit qu'en mémoire, le temps que l'appelant la chiffre à son tour pour le
 * destinataire (voir syncEngine, cas `upload_message`).
 */
export async function encryptFile(
  localUri: string,
): Promise<{ encryptedUri: string; fileKey: Uint8Array }> {
  const path = stripFilePrefix(localUri);

  // Vérifie la taille AVANT toute lecture — évite de charger un fichier
  // énorme en mémoire juste pour découvrir après coup qu'on doit le rejeter.
  const stat = await ReactNativeBlobUtil.fs.stat(path);
  const size = Number(stat.size) || 0;
  if (size > MAX_FILE_SIZE) throw new FileTooLargeError(size);

  const plainB64 = await ReactNativeBlobUtil.fs.readFile(path, 'base64');
  const plainBytes = fromBase64(plainB64);

  const fileKey = randomBytes(32);
  const { nonce, ciphertext } = aeadEncrypt(fileKey, plainBytes);
  const onDisk = concatBytes(nonce, ciphertext);

  await ensureUploadDir();
  const outPath = `${UPLOAD_DIR}/${Date.now()}-${Math.random().toString(36).slice(2)}.bin`;
  await ReactNativeBlobUtil.fs.writeFile(outPath, toBase64(onDisk), 'base64');

  return { encryptedUri: `file://${outPath}`, fileKey };
}

/**
 * Déchiffre un fichier téléchargé (blob nonce+ciphertext, voir `encryptFile`)
 * et écrit le résultat en clair à `outputUri`. Lève si le tag AEAD est
 * invalide (fichier corrompu, ou clé incorrecte) — à l'appelant de dégrader
 * proprement (voir `mediaCache.ts`, ne doit jamais remonter jusqu'à l'UI).
 */
export async function decryptFile(
  encryptedLocalUri: string,
  fileKey: Uint8Array,
  outputUri: string,
): Promise<void> {
  const inPath = stripFilePrefix(encryptedLocalUri);
  const outPath = stripFilePrefix(outputUri);

  const onDiskB64 = await ReactNativeBlobUtil.fs.readFile(inPath, 'base64');
  const onDisk = fromBase64(onDiskB64);
  if (onDisk.length < NONCE_LEN) throw new Error('encrypted file too short');

  const nonce = onDisk.slice(0, NONCE_LEN);
  const ciphertext = onDisk.slice(NONCE_LEN);
  const plainBytes = aeadDecrypt(fileKey, nonce, ciphertext);

  await ReactNativeBlobUtil.fs.writeFile(outPath, toBase64(plainBytes), 'base64');
}

export { MAX_FILE_SIZE as FILE_MAX_SIZE_BYTES };
