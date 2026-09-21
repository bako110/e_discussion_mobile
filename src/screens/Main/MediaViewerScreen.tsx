import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Video, { type VideoRef } from 'react-native-video';

import { CachedImage, Icon } from '@/components/common';
import type { MainScreenProps } from '@/navigation/types';
import { messageService } from '@/services';
import { mediaCache } from '@/services/mediaCache';
import { mediaUrl } from '@/utils/media';

/**
 * Visionneuse plein écran d'un média.
 *  - Image : `contain`.
 *  - Vidéo : lecteur `react-native-video` intégré (lecture DANS l'app, comme
 *    WhatsApp), contrôles natifs. Si `messageId` est fourni (média reçu),
 *    l'ouverture du lecteur marque le message « ouvert » (écran Infos).
 */
export const MediaViewerScreen: React.FC<MainScreenProps<'MediaViewer'>> = ({
  route,
  navigation,
}) => {
  const { type, thumbnailUrl, messageId, viewOnceMessageId, gallery, enc } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // navigation précédent/suivant au sein d'un envoi groupé (voir
  // MediaGroupBubble) — `galleryIndex` prime sur `route.params.url` une fois
  // qu'on a bougé, pour rester dans la liste fournie à l'ouverture.
  const [galleryIndex, setGalleryIndex] = useState(gallery?.index ?? 0);
  const url = gallery ? gallery.urls[galleryIndex]! : route.params.url;

  const videoRef = useRef<VideoRef>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  // image/vidéo : URI affichable — pour une vue unique, TOUJOURS un fichier
  // temporaire téléchargé ici (jamais le cache persistant habituel). Pour un
  // média CHIFFRÉ non encore en cache, l'URL distante est un blob illisible :
  // on ne l'affiche jamais directement, on attend le fetch+déchiffrement.
  const [displayUri, setDisplayUri] = useState<string | null>(() => {
    if (viewOnceMessageId) return null;
    const local = mediaCache.localFor(url);
    if (local) return local;
    return enc ? null : (mediaUrl(url) ?? url);
  });
  // chemin temporaire à effacer à la fermeture (vue unique uniquement).
  const tempPathRef = useRef<string | null>(null);
  // pour ne confirmer/effacer qu'une seule fois même si l'écran se démonte 2x.
  const consumedRef = useRef(false);

  useEffect(() => {
    if (!viewOnceMessageId) {
      if (type === 'video' && messageId) messageService.markPlayed(messageId);
      if (type === 'video' || enc) {
        // Vidéo : jamais auto-téléchargée en amont (comme dans MessageBubble)
        // -> on la récupère ici. Image chiffrée : idem, jamais affichée tant
        // qu'elle n'est pas déchiffrée localement.
        void mediaCache.fetchNow(url, { enc }).then((local) => {
          if (local) setDisplayUri(local);
          else if (enc) setFailed(true);
        });
      } else {
        // image en clair (y compris navigation précédent/suivant en galerie) :
        // même résolution que l'état initial, ré-exécutée à chaque `url`.
        setDisplayUri(mediaCache.localFor(url) ?? mediaUrl(url) ?? url);
      }
      return;
    }
    // Vue unique : télécharge dans un dossier TEMPORAIRE avant toute
    // confirmation au serveur — l'ordre garantit que le média a bien fini de
    // charger avant que le fichier ne disparaisse côté serveur.
    void mediaCache.fetchTemp(url, { enc }).then((local) => {
      if (!local) {
        setFailed(true);
        setLoading(false);
        return;
      }
      tempPathRef.current = local;
      setDisplayUri(local);
    });
  }, [type, url, messageId, viewOnceMessageId, enc]);

  useEffect(() => {
    if (type === 'image') setLoading(false);
  }, [type, displayUri]);

  // Fermeture du viewer (retour arrière, navigation ailleurs) : le média
  // vue-unique a été affiché au moins une fois -> on efface la copie
  // temporaire locale ET on confirme "ouvert" au serveur (qui supprime le
  // fichier définitivement). Fait UNE seule fois.
  useFocusEffect(
    useCallback(() => {
      return () => {
        videoRef.current?.pause();
        if (viewOnceMessageId && !consumedRef.current) {
          consumedRef.current = true;
          void mediaCache.deleteTemp(tempPathRef.current);
          void messageService.openViewOnce(viewOnceMessageId).catch(() => undefined);
        }
      };
    }, [viewOnceMessageId]),
  );

  const hasPrev = !!gallery && galleryIndex > 0;
  const hasNext = !!gallery && galleryIndex < gallery.urls.length - 1;

  return (
    <View style={styles.root}>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <Icon name="close" size={26} color="#fff" />
      </Pressable>

      {gallery ? (
        <View style={[styles.counter, { top: insets.top + 16 }]} pointerEvents="none">
          <Text style={styles.counterTxt}>
            {galleryIndex + 1} / {gallery.urls.length}
          </Text>
        </View>
      ) : null}

      {hasPrev ? (
        <Pressable
          onPress={() => {
            setLoading(true);
            setGalleryIndex((i) => i - 1);
          }}
          hitSlop={12}
          style={[styles.navArrow, styles.navArrowLeft]}
        >
          <Icon name="chevron-left" size={30} color="#fff" />
        </Pressable>
      ) : null}
      {hasNext ? (
        <Pressable
          onPress={() => {
            setLoading(true);
            setGalleryIndex((i) => i + 1);
          }}
          hitSlop={12}
          style={[styles.navArrow, styles.navArrowRight]}
        >
          <Icon name="chevron-right" size={30} color="#fff" />
        </Pressable>
      ) : null}

      {failed ? (
        <View style={styles.center}>
          <Icon name="alert-circle-outline" size={40} color="#ffffffaa" />
          <Text style={styles.hint}>{t('errors.generic')}</Text>
        </View>
      ) : !displayUri ? (
        <View style={styles.center} pointerEvents="none">
          {thumbnailUrl ? (
            <CachedImage uri={thumbnailUrl} style={StyleSheet.absoluteFill} resizeMode="contain" />
          ) : null}
          <ActivityIndicator color="#fff" size="large" />
        </View>
      ) : type === 'image' ? (
        <CachedImage uri={displayUri} forceDownload style={styles.image} resizeMode="contain" />
      ) : (
        <View style={styles.videoWrap}>
          <Video
            ref={videoRef}
            source={{ uri: displayUri }}
            style={StyleSheet.absoluteFill}
            resizeMode="contain"
            controls
            paused={false}
            onLoad={() => setLoading(false)}
            onError={() => {
              setFailed(true);
              setLoading(false);
            }}
            onEnd={() => videoRef.current?.seek(0)}
          />
          {loading ? (
            <View style={styles.center} pointerEvents="none">
              {thumbnailUrl ? (
                <CachedImage uri={thumbnailUrl} style={StyleSheet.absoluteFill} resizeMode="contain" />
              ) : null}
              <ActivityIndicator color="#fff" size="large" />
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    right: 12,
    zIndex: 10,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { width: '100%', height: '100%' },
  videoWrap: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  center: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  hint: { color: '#ffffffcc', fontSize: 13, marginTop: 8 },
  counter: {
    position: 'absolute',
    alignSelf: 'center',
    zIndex: 10,
    backgroundColor: 'rgba(0,0,0,0.4)',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  counterTxt: { color: '#fff', fontSize: 12.5, fontWeight: '700' },
  navArrow: {
    position: 'absolute',
    top: '50%',
    marginTop: -22,
    zIndex: 10,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  navArrowLeft: { left: 8 },
  navArrowRight: { right: 8 },
});
