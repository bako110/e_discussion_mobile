/**
 * <Image> avec cache disque transparent (voir `mediaCache`).
 *
 * Affiche d'abord ce qui est disponible (fichier local si déjà en cache,
 * sinon l'URL distante), puis bascule sur le fichier local dès qu'il est
 * téléchargé. Hors-ligne, un média déjà vu reste affiché.
 *
 * Si le fichier local est manquant/corrompu (`onError`), on retombe sur
 * l'URL distante une fois (utile après un vidage partiel du cache).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Image, type ImageProps, type ImageStyle, type StyleProp } from 'react-native';

import { mediaCache } from '@/services/mediaCache';
import { mediaUrl } from '@/utils/media';

interface Props extends Omit<ImageProps, 'source' | 'style'> {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
}

export const CachedImage: React.FC<Props> = ({ uri, style, onError, ...rest }) => {
  const mounted = useRef(true);
  const triedRemote = useRef(false);

  const [src, setSrc] = useState<string | undefined>(() =>
    mediaCache.resolve(uri, (local) => mounted.current && setSrc(local)),
  );

  useEffect(() => {
    mounted.current = true;
    triedRemote.current = false;
    setSrc(mediaCache.resolve(uri, (local) => mounted.current && setSrc(local)));
    return () => {
      mounted.current = false;
    };
  }, [uri]);

  const handleError = useCallback(
    (e: Parameters<NonNullable<ImageProps['onError']>>[0]) => {
      // fichier local KO -> on essaie l'URL distante une seule fois
      if (!triedRemote.current && uri) {
        triedRemote.current = true;
        const remote = mediaUrl(uri);
        if (remote && remote !== src) {
          setSrc(remote);
          return;
        }
      }
      onError?.(e);
    },
    [uri, src, onError],
  );

  if (!src) return null;
  return <Image {...rest} source={{ uri: src }} style={style} onError={handleError} />;
};
