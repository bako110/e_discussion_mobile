/**
 * Cache DISQUE des médias distants (images, miniatures, vidéos, vocaux).
 *
 * Comportement WhatsApp : un média téléchargé une fois reste visible hors-ligne.
 * Au premier accès on télécharge dans `CacheDir/media/<hash><ext>` ; ensuite on
 * sert le fichier local. Les URI locales (`file://`, `content://`, `data:`)
 * passent tel quel — rien à cacher.
 *
 * Best-effort : toute erreur (pas de réseau, écriture impossible) retombe
 * silencieusement sur l'URL d'origine.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';

import { mediaUrl } from '@/utils/media';

const DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/media`;
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

/** Hash stable et court d'une URL (variante djb2 sans opérateurs bit à bit). */
function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33 + s.charCodeAt(i)) % 2147483647;
  }
  return h.toString(36);
}

function extFromUrl(u: string): string {
  const m = /\.([a-z0-9]{2,5})(?:\?|$)/i.exec(u);
  return m ? `.${m[1].toLowerCase()}` : '';
}

function isLocal(u: string): boolean {
  return /^(file:|content:|data:|blob:)/.test(u);
}

// requêtes de téléchargement en cours (dédup)
const inFlight = new Map<string, Promise<string | null>>();
// mémoïsation résolue (URL distante -> chemin local file://)
const resolved = new Map<string, string>();

async function download(remote: string, localPath: string): Promise<string | null> {
  try {
    await ensureDir();
    const res = await ReactNativeBlobUtil.config({
      path: localPath,
      fileCache: true,
      overwrite: true,
      timeout: 30000,
    }).fetch('GET', remote);
    const status = res.info().status;
    if (status >= 200 && status < 300) return `file://${localPath}`;
    // réponse invalide : on nettoie le fichier partiel
    void ReactNativeBlobUtil.fs.unlink(localPath).catch(() => undefined);
    return null;
  } catch {
    return null;
  }
}

export const mediaCache = {
  /**
   * Renvoie un chemin AFFICHABLE tout de suite :
   *  - URI locale -> telle quelle ;
   *  - déjà en cache -> `file://…` ;
   *  - sinon -> l'URL distante (résolue) + lance le téléchargement en fond
   *    (le prochain rendu prendra le fichier local).
   *
   * `onCached` est appelé quand le fichier local devient disponible.
   */
  resolve(rawUrl: string | null | undefined, onCached?: (localUri: string) => void): string | undefined {
    if (!rawUrl) return undefined;
    if (isLocal(rawUrl)) return rawUrl;

    const remote = mediaUrl(rawUrl) ?? rawUrl;
    const cached = resolved.get(remote);
    if (cached) return cached;

    const localPath = `${DIR}/${hash(remote)}${extFromUrl(remote)}`;

    // vérifie l'existence + télécharge si besoin, en arrière-plan.
    // `onCached` est TOUJOURS rebranché sur le job en cours, même si un
    // précédent render a déjà lancé le téléchargement (sinon le composant
    // resté sur l'URL distante ne bascule jamais sur le fichier local).
    void (async () => {
      try {
        if (await ReactNativeBlobUtil.fs.exists(localPath)) {
          const uri = `file://${localPath}`;
          resolved.set(remote, uri);
          onCached?.(uri);
          return;
        }
        let job = inFlight.get(remote);
        if (!job) {
          job = download(remote, localPath);
          inFlight.set(remote, job);
          void job.finally(() => inFlight.delete(remote));
        }
        const uri = await job;
        if (uri) {
          resolved.set(remote, uri);
          onCached?.(uri);
        }
      } catch {
        /* best-effort */
      }
    })();

    // en attendant : l'URL distante (marche si en ligne, placeholder sinon)
    return remote;
  },

  /**
   * Associe un FICHIER LOCAL déjà présent (celui que l'utilisateur vient
   * d'envoyer) à l'URL serveur qui lui correspond — pour que `<CachedImage>`
   * l'affiche instantanément après l'upload, sans re-télécharger et même
   * hors-ligne. Copie le fichier dans `CacheDir/media/<hash(url serveur)>`.
   */
  async adopt(serverUrl: string | null | undefined, localUri: string | null | undefined): Promise<void> {
    if (!serverUrl || !localUri) return;
    const remote = mediaUrl(serverUrl) ?? serverUrl;
    if (isLocal(remote)) return; // déjà local
    const src = localUri.startsWith('file://') ? localUri.slice(7) : localUri;
    const dst = `${DIR}/${hash(remote)}${extFromUrl(remote) || extFromUrl(localUri)}`;
    try {
      await ensureDir();
      if (await ReactNativeBlobUtil.fs.exists(dst)) {
        resolved.set(remote, `file://${dst}`);
        return;
      }
      if (!(await ReactNativeBlobUtil.fs.exists(src))) return;
      await ReactNativeBlobUtil.fs.cp(src, dst);
      resolved.set(remote, `file://${dst}`);
    } catch {
      /* best-effort : le cache normal re-téléchargera si besoin */
    }
  },

  /** Vide le cache disque (Réglages → Stockage). */
  async clear(): Promise<void> {
    resolved.clear();
    inFlight.clear();
    try {
      await ReactNativeBlobUtil.fs.unlink(DIR);
    } catch {
      /* déjà vide */
    }
    dirReady = null;
  },

  /** Taille approximative du cache média en octets. */
  async size(): Promise<number> {
    try {
      if (!(await ReactNativeBlobUtil.fs.isDir(DIR))) return 0;
      const names = await ReactNativeBlobUtil.fs.ls(DIR);
      let total = 0;
      for (const n of names) {
        const stat = await ReactNativeBlobUtil.fs.stat(`${DIR}/${n}`);
        total += Number(stat.size) || 0;
      }
      return total;
    } catch {
      return 0;
    }
  },
};
