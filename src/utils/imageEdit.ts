/**
 * Helpers d'édition d'image AVANT upload (recadrage local, façon WhatsApp).
 *
 * `react-native-image-crop-picker` a besoin d'un chemin FICHIER lisible
 * (`file://…` ou chemin absolu nu) — il ne gère pas `content://` de façon
 * fiable. `ensureFilePath` copie au besoin le contenu vers le cache.
 */
import { Image } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';
import ImagePicker from 'react-native-image-crop-picker';

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
 * garde ; si c'est un `content://` (galerie / document Android) on le copie
 * dans le cache. Sur échec on renvoie l'URI d'origine (best-effort).
 */
export async function ensureFilePath(uri: string): Promise<string> {
  if (uri.startsWith('file://')) return uri;
  if (/^\//.test(uri)) return `file://${uri}`;
  if (!uri.startsWith('content://')) return uri;
  try {
    await ensureDir();
    const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(uri);
    const ext = m ? `.${m[1].toLowerCase()}` : '.jpg';
    const dest = `${DIR}/pick_${Date.now()}${ext}`;
    // cp gère content:// -> fichier sur Android
    await ReactNativeBlobUtil.fs.cp(uri, dest);
    return `file://${dest}`;
  } catch {
    return uri;
  }
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
 * Ouvre l'éditeur de recadrage natif. Résout d'abord un chemin fichier fiable.
 * `null` si l'utilisateur annule. Lève sur vraie erreur.
 */
export async function cropImage(rawUri: string, opts: CropOpts = {}): Promise<CropResult | null> {
  const path = await ensureFilePath(rawUri);
  try {
    const res = (await ImagePicker.openCropper({
      path,
      mediaType: 'photo',
      freeStyleCropEnabled: opts.freeStyle ?? !opts.circle,
      cropperCircleOverlay: !!opts.circle,
      width: opts.width ?? (opts.circle ? 512 : 1080),
      height: opts.height ?? (opts.circle ? 512 : 1350),
      cropperToolbarTitle: opts.title ?? 'Recadrer',
      cropperActiveWidgetColor: '#1E6FE0',
      cropperToolbarColor: '#000000',
      cropperToolbarWidgetColor: '#FFFFFF',
      hideBottomControls: false,
      enableRotationGesture: true,
      compressImageQuality: 0.9,
      forceJpg: true,
    })) as { path?: string; width?: number; height?: number };
    if (!res?.path) return null;
    return {
      uri: asDisplayUri(res.path),
      width: res.width ?? 0,
      height: res.height ?? 0,
    };
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (/cancel/i.test(msg)) return null;
    throw e;
  }
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
