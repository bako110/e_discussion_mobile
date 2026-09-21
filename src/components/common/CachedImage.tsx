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

import { mediaCache, type MediaEncContext } from '@/services/mediaCache';
import { mediaUrl } from '@/utils/media';

interface Props extends Omit<ImageProps, 'source' | 'style'> {
  uri: string | null | undefined;
  style?: StyleProp<ImageStyle>;
  /** Force le téléchargement même si l'auto-download est coupé (ex: plein écran). */
  forceDownload?: boolean;
  /** Pièce jointe 1-to-1 chiffrée (voir `mediaCache.encCtxFor`) — `undefined`
   * pour un média en clair (avatars, stories, groupes, anciens envois). */
  enc?: MediaEncContext;
}

export const CachedImage: React.FC<Props> = ({
  uri,
  style,
  onError,
  forceDownload,
  enc,
  ...rest
}) => {
  const mounted = useRef(true);
  const triedRemote = useRef(false);

  const [src, setSrc] = useState<string | undefined>(() =>
    mediaCache.resolve(uri, (local) => mounted.current && setSrc(local), {
      force: forceDownload,
      enc,
    }),
  );

  useEffect(() => {
    mounted.current = true;
    triedRemote.current = false;
    setSrc(
      mediaCache.resolve(uri, (local) => mounted.current && setSrc(local), {
        force: forceDownload,
        enc,
      }),
    );
    return () => {
      mounted.current = false;
    };
  }, [uri, forceDownload, enc]);

  const handleError = useCallback(
    (e: Parameters<NonNullable<ImageProps['onError']>>[0]) => {
      // fichier local KO -> on essaie l'URL distante une seule fois — SAUF
      // pour un média chiffré : l'URL distante est un blob illisible tel
      // quel, le proposer directement à <Image> ne ferait qu'échouer à
      // nouveau (au mieux) ; on dégrade directement vers "média indisponible".
      if (!triedRemote.current && uri && !enc) {
        triedRemote.current = true;
        const remote = mediaUrl(uri);
        if (remote && remote !== src) {
          setSrc(remote);
          return;
        }
      }
      onError?.(e);
    },
    [uri, src, onError, enc],
  );

  if (!src) return null;
  return <Image {...rest} source={{ uri: src }} style={style} onError={handleError} />;
};
