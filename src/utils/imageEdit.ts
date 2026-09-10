/**
 * Helpers d'édition d'image AVANT upload (recadrage local, façon WhatsApp).
 *
 * Le recadrage passe par l'éditeur JS interne (`CropModal` : glisser + pincer
 * sur un cadre fixe, découpe pixel via `@react-native-community/image-editor`).
 * On n'utilise PLUS `react-native-image-crop-picker` pour le crop : sur cette
 * app (new architecture + Hermes) son `openCropper` échoue silencieusement
 * selon l'appareil, d'où le recadrage « qui revient tout de suite ».
 *
 * `ensureFilePath` transforme un `content://` (galerie Android) en `file://…`
 * réel — `image-editor` comme l'éditeur natif ne lisent pas `content://`.
 */
import { Image } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

const DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/edit`;
let dirReady: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = ReactNativeBlobUtil.fs
      .isDir(DIR)
      .then((ok) => (ok ? undefined : ReactNativeBlobUtil.fs.mkdir(DIR).then(() => undefined)))
      .catch(() => undefined);
  }
  return dirReady;
}

/** URI utilisable par <Image> : ne préfixe `file://` QUE sur un chemin nu. */
export function asDisplayUri(p: string): string {
  return /^(content:|file:|http|data:)/.test(p) ? p : `file://${p}`;
}

/**
 * Renvoie un chemin `file://…` réel pour `uri`. Si c'est déjà un fichier on le
 * garde ; si c'est un `content://` (galerie / document Android) on en fait une
 * COPIE LOCALE — `Image.getSize` et `image-editor` ne lisent pas `content://`.
 *
 * `fs.cp` ne sait PAS lire une source `content://` sur Android — on passe par
 * une lecture base64 (supportée) puis une écriture fichier.
 */
export async function ensureFilePath(uri: string): Promise<string> {
  if (uri.startsWith('file://')) return uri;
  if (/^\//.test(uri)) return `file://${uri}`;
  if (!uri.startsWith('content://')) return uri;
  await ensureDir();
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(uri);
  const ext = m ? `.${m[1].toLowerCase()}` : '.jpg';
  const dest = `${DIR}/pick_${Date.now()}${ext}`;
  // 1) tentative directe (certaines versions/ROMs l'acceptent)
  try {
    await ReactNativeBlobUtil.fs.cp(uri, dest);
    if (await ReactNativeBlobUtil.fs.exists(dest)) return `file://${dest}`;
  } catch {
    /* on tente le base64 ci-dessous */
  }
  // 2) lecture base64 -> écriture fichier
  try {
    const b64 = await ReactNativeBlobUtil.fs.readFile(uri, 'base64');
    await ReactNativeBlobUtil.fs.writeFile(dest, b64, 'base64');
    if (await ReactNativeBlobUtil.fs.exists(dest)) return `file://${dest}`;
  } catch (e) {
    console.warn('[imageEdit] content:// copy failed:', e);
  }
  return uri;
}

export interface CropResult {
  uri: string; // file://… recadré
  width: number;
  height: number;
}

export interface CropOpts {
  circle?: boolean;
  /** cadre par défaut (ratio) ; ignoré si `freeStyle` (défaut) */
  width?: number;
  height?: number;
  freeStyle?: boolean;
  title?: string;
}

/**
 * Recadrage local d'une image (façon WhatsApp) via l'éditeur JS interne
 * (`CropModal`). `null` si l'utilisateur annule.
 */
export async function cropImage(rawUri: string, opts: CropOpts = {}): Promise<CropResult | null> {
  const path = await ensureFilePath(rawUri);
  const { openCrop } = await import('@/components/common');
  const aspect = opts.circle
    ? 1
    : opts.freeStyle
      ? undefined
      : opts.width && opts.height
        ? opts.width / opts.height
        : undefined;
  const res = await openCrop(path, {
    circle: opts.circle,
    aspect,
    title: opts.title,
  });
  return res ? { uri: res.uri, width: res.width, height: res.height } : null;
}

/** Dimensions réelles (px) d'une image locale ou distante. `null` si échec. */
export function getImageSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      asDisplayUri(uri),
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}
