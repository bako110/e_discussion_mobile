/**
 * Cache DISQUE PERSISTANT des médias distants (images, miniatures, vidéos,
 * vocaux, documents).
 *
 * Comportement WhatsApp :
 *  - un média téléchargé une fois reste accessible HORS-LIGNE, même après
 *    redémarrage (stocké dans `DocumentDir/media`, pas dans le cache système
 *    que l'OS peut purger) ;
 *  - les images se téléchargent automatiquement selon le réglage
 *    Wi-Fi / données ; la VIDÉO, le VOCAL et les DOCUMENTS ne se téléchargent
 *    QUE sur tap explicite (`fetchNow`).
 *
 * Best-effort : toute erreur (pas de réseau, écriture impossible) retombe
 * silencieusement sur l'URL d'origine.
 */
import ReactNativeBlobUtil from 'react-native-blob-util';
import NetInfo from '@react-native-community/netinfo';

import { mediaUrl } from '@/utils/media';
import { storage } from '@/utils/storage';

const DIR = `${ReactNativeBlobUtil.fs.dirs.DocumentDir}/media`;
const LEGACY_DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/media`;
let dirReady: Promise<void> | null = null;

function ensureDir(): Promise<void> {
  if (!dirReady) {
    dirReady = (async () => {
      try {
        if (!(await ReactNativeBlobUtil.fs.isDir(DIR))) {
          await ReactNativeBlobUtil.fs.mkdir(DIR);
        }
        // migration unique : ancien cache (CacheDir) -> dossier persistant
        if (await ReactNativeBlobUtil.fs.isDir(LEGACY_DIR)) {
          const names = await ReactNativeBlobUtil.fs.ls(LEGACY_DIR);
          for (const n of names) {
            const dst = `${DIR}/${n}`;
            if (!(await ReactNativeBlobUtil.fs.exists(dst))) {
              await ReactNativeBlobUtil.fs.cp(`${LEGACY_DIR}/${n}`, dst).catch(() => undefined);
            }
          }
          await ReactNativeBlobUtil.fs.unlink(LEGACY_DIR).catch(() => undefined);
        }
      } catch {
        /* best-effort */
      }
    })();
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

function pathFor(remote: string): string {
  return `${DIR}/${hash(remote)}${extFromUrl(remote)}`;
}

// requêtes de téléchargement en cours (dédup)
const inFlight = new Map<string, Promise<string | null>>();
// mémoïsation résolue (URL distante -> chemin local file://)
const resolved = new Map<string, string>();
// abonnés « ce média vient d'arriver en local » (clé = URL distante résolue)
const listeners = new Map<string, Set<(localUri: string) => void>>();
// progression de téléchargement 0..1 (clé = URL distante résolue)
const progress = new Map<string, number>();

function emitCached(remote: string, uri: string): void {
  resolved.set(remote, uri);
  progress.delete(remote);
  const subs = listeners.get(remote);
  if (subs) for (const cb of subs) cb(uri);
}

// type de connexion courant (mis à jour par NetInfo)
let connectionType: string | null = null;
NetInfo.addEventListener((s) => {
  connectionType = s.type;
});
void NetInfo.fetch().then((s) => {
  connectionType = s.type;
});

function bool(key: string, fallback: boolean): boolean {
  try {
    const v = storage.getString(key);
    return v == null ? fallback : v === '1';
  } catch {
    return fallback;
  }
}

/** Le téléchargement AUTOMATIQUE est-il autorisé sur le réseau actuel ?
 * (Réglages → Stockage → « Téléchargement auto »). `fetchNow` (tap explicite)
 * télécharge toujours, quel que soit le réseau. */
function autoDownloadAllowed(): boolean {
  if (connectionType === 'cellular') return bool('storage.autoDownloadData', false);
  if (connectionType === 'wifi' || connectionType === 'ethernet') {
    return bool('storage.autoDownloadWifi', true);
  }
  return true;
}

async function download(
  remote: string,
  localPath: string,
  onProgress?: (p: number) => void,
): Promise<string | null> {
  try {
    await ensureDir();
    const task = ReactNativeBlobUtil.config({
      path: localPath,
      fileCache: true,
      overwrite: true,
      timeout: 60000,
    }).fetch('GET', remote);
    if (onProgress) {
      task.progress({ interval: 250 }, (received, total) => {
        const p = total > 0 ? Math.min(1, received / total) : 0;
        progress.set(remote, p);
        onProgress(p);
      });
    }
    const res = await task;
    const status = res.info().status;
    if (status >= 200 && status < 300) return `file://${localPath}`;
    void ReactNativeBlobUtil.fs.unlink(localPath).catch(() => undefined);
    return null;
  } catch {
    void ReactNativeBlobUtil.fs.unlink(localPath).catch(() => undefined);
    return null;
  }
}

export type MediaCacheState = 'local' | 'remote' | 'downloading' | 'missing';

export const mediaCache = {
  /**
   * Renvoie un chemin AFFICHABLE tout de suite :
   *  - URI locale -> telle quelle ;
   *  - déjà en cache -> `file://…` ;
   *  - sinon -> l'URL distante (résolue) + lance le téléchargement en fond
   *    SI le téléchargement auto est autorisé (`opts.force` pour forcer).
   *
   * `onCached` est appelé quand le fichier local devient disponible.
   */
  resolve(
    rawUrl: string | null | undefined,
    onCached?: (localUri: string) => void,
    opts?: { force?: boolean },
  ): string | undefined {
    if (!rawUrl) return undefined;
    if (isLocal(rawUrl)) return rawUrl;

    const remote = mediaUrl(rawUrl) ?? rawUrl;
    const cached = resolved.get(remote);
    if (cached) return cached;

    const localPath = pathFor(remote);
    const mayDownload = opts?.force || autoDownloadAllowed();

    void (async () => {
      try {
        if (await ReactNativeBlobUtil.fs.exists(localPath)) {
          emitCached(remote, `file://${localPath}`);
          onCached?.(`file://${localPath}`);
          return;
        }
        if (!mayDownload) return;
        let job = inFlight.get(remote);
        if (!job) {
          job = download(remote, localPath);
          inFlight.set(remote, job);
          void job.finally(() => inFlight.delete(remote));
        }
        const uri = await job;
        if (uri) {
          emitCached(remote, uri);
          onCached?.(uri);
        }
      } catch {
        /* best-effort */
      }
    })();

    return remote;
  },

  /** Chemin local `file://…` SI déjà connu en mémoire (synchrone). */
  localFor(rawUrl: string | null | undefined): string | null {
    if (!rawUrl) return null;
    if (isLocal(rawUrl)) return rawUrl;
    const remote = mediaUrl(rawUrl) ?? rawUrl;
    return resolved.get(remote) ?? null;
  },

  /** Progression courante d'un téléchargement (0..1) ou `null`. */
  progressFor(rawUrl: string | null | undefined): number | null {
    if (!rawUrl) return null;
    const remote = mediaUrl(rawUrl) ?? rawUrl;
    return progress.get(remote) ?? null;
  },

  /**
   * Vérifie le DISQUE (async) : renvoie le `file://…` si présent, sinon `null`.
   * Met à jour la table mémoire au passage.
   */
  async probe(rawUrl: string | null | undefined): Promise<string | null> {
    if (!rawUrl) return null;
    if (isLocal(rawUrl)) return rawUrl;
    const remote = mediaUrl(rawUrl) ?? rawUrl;
    const known = resolved.get(remote);
    if (known) return known;
    try {
      const localPath = pathFor(remote);
      if (await ReactNativeBlobUtil.fs.exists(localPath)) {
        const uri = `file://${localPath}`;
        resolved.set(remote, uri);
        return uri;
      }
    } catch {
      /* noop */
    }
    return null;
  },

  /**
   * Téléchargement EXPLICITE (tap explicite sur le bouton), quel que soit le réseau. Résout le
   * `file://…` local (et le persiste), ou `null` en cas d'échec.
   */
  async fetchNow(
    rawUrl: string | null | undefined,
    opts?: { onProgress?: (p: number) => void },
  ): Promise<string | null> {
    if (!rawUrl) return null;
    if (isLocal(rawUrl)) return rawUrl;
    const remote = mediaUrl(rawUrl) ?? rawUrl;

    const known = resolved.get(remote);
    if (known) return known;

    const localPath = pathFor(remote);
    try {
      if (await ReactNativeBlobUtil.fs.exists(localPath)) {
        emitCached(remote, `file://${localPath}`);
        return `file://${localPath}`;
      }
    } catch {
      /* noop */
    }

    let job = inFlight.get(remote);
    if (!job) {
      progress.set(remote, 0);
      job = download(remote, localPath, opts?.onProgress);
      inFlight.set(remote, job);
      void job.finally(() => inFlight.delete(remote));
    }
    const uri = await job;
    if (uri) emitCached(remote, uri);
    else progress.delete(remote);
    return uri;
  },

  /** S'abonne à « ce média est maintenant local ». Renvoie la fonction de désabonnement. */
  subscribe(rawUrl: string | null | undefined, cb: (localUri: string) => void): () => void {
    if (!rawUrl || isLocal(rawUrl)) return () => undefined;
    const remote = mediaUrl(rawUrl) ?? rawUrl;
    let set = listeners.get(remote);
    if (!set) {
      set = new Set();
      listeners.set(remote, set);
    }
    set.add(cb);
    return () => {
      set?.delete(cb);
      if (set && set.size === 0) listeners.delete(remote);
    };
  },

  /**
   * Associe un FICHIER LOCAL déjà présent (celui que l'utilisateur vient
   * d'envoyer) à l'URL serveur correspondante — pour l'afficher sans
   * re-télécharger et hors-ligne. Copie dans le dossier persistant.
   */
  async adopt(serverUrl: string | null | undefined, localUri: string | null | undefined): Promise<void> {
    if (!serverUrl || !localUri) return;
    const remote = mediaUrl(serverUrl) ?? serverUrl;
    if (isLocal(remote)) return;
    const src = localUri.startsWith('file://') ? localUri.slice(7) : localUri;
    const dst = `${DIR}/${hash(remote)}${extFromUrl(remote) || extFromUrl(localUri)}`;
    try {
      await ensureDir();
      if (await ReactNativeBlobUtil.fs.exists(dst)) {
        emitCached(remote, `file://${dst}`);
        return;
      }
      if (!(await ReactNativeBlobUtil.fs.exists(src))) return;
      await ReactNativeBlobUtil.fs.cp(src, dst);
      emitCached(remote, `file://${dst}`);
    } catch {
      /* best-effort */
    }
  },

  /** Vide le cache disque (Réglages → Stockage). */
  async clear(): Promise<void> {
    resolved.clear();
    inFlight.clear();
    progress.clear();
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
      await ensureDir();
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
