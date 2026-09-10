/**
 * État d'un média distant vis-à-vis du cache disque persistant, + action de
 * téléchargement explicite (façon WhatsApp : la vidéo / le vocal / le document
 * ne se téléchargent qu'au tap).
 *
 *   const m = useCachedMedia(msg.attachment_url);
 *   m.localUri     // file://… si dispo, sinon null
 *   m.state        // 'local' | 'remote' | 'downloading' | 'missing'
 *   m.progress     // 0..1 pendant le téléchargement
 *   m.download()   // lance le téléchargement explicite (ignore le réglage réseau)
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { mediaCache, type MediaCacheState } from '@/services/mediaCache';

export interface CachedMedia {
  localUri: string | null;
  state: MediaCacheState;
  progress: number;
  downloading: boolean;
  /** Télécharge maintenant (tap explicite). No-op si déjà local. */
  download: () => Promise<string | null>;
}

export function useCachedMedia(rawUrl: string | null | undefined): CachedMedia {
  const isLocalUri = !!rawUrl && /^(file:|content:|data:|blob:)/.test(rawUrl);
  const [localUri, setLocalUri] = useState<string | null>(
    isLocalUri ? (rawUrl as string) : mediaCache.localFor(rawUrl),
  );
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // (re)synchronise quand l'URL change
  useEffect(() => {
    if (isLocalUri) {
      setLocalUri(rawUrl as string);
      return;
    }
    const known = mediaCache.localFor(rawUrl);
    setLocalUri(known);
    if (!known && rawUrl) {
      // vérifie le disque (peut avoir été téléchargé lors d'une session passée)
      void mediaCache.probe(rawUrl).then((uri) => {
        if (uri && mounted.current) setLocalUri(uri);
      });
    }
    const unsub = mediaCache.subscribe(rawUrl, (uri) => {
      if (!mounted.current) return;
      setLocalUri(uri);
      setDownloading(false);
      setProgress(1);
    });
    return unsub;
  }, [rawUrl, isLocalUri]);

  const download = useCallback(async () => {
    if (!rawUrl || isLocalUri) return localUri;
    const already = mediaCache.localFor(rawUrl);
    if (already) {
      setLocalUri(already);
      return already;
    }
    setDownloading(true);
    setProgress(mediaCache.progressFor(rawUrl) ?? 0);
    try {
      const uri = await mediaCache.fetchNow(rawUrl, {
        onProgress: (p) => mounted.current && setProgress(p),
      });
      if (mounted.current) {
        setLocalUri(uri);
        setDownloading(false);
      }
      return uri;
    } catch {
      if (mounted.current) setDownloading(false);
      return null;
    }
  }, [rawUrl, isLocalUri, localUri]);

  const state: MediaCacheState = localUri
    ? 'local'
    : downloading
      ? 'downloading'
      : rawUrl
        ? 'missing'
        : 'remote';

  return { localUri, state, progress, downloading, download };
}
