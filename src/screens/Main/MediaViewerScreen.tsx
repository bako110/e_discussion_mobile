import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
  const { url, type, thumbnailUrl, messageId } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const videoRef = useRef<VideoRef>(null);
  const [loading, setLoading] = useState(type === 'video');
  const [failed, setFailed] = useState(false);
  // vidéo : le fichier local si déjà téléchargé, sinon l'URL distante
  const [videoUri, setVideoUri] = useState<string>(
    () => mediaCache.localFor(url) ?? mediaUrl(url) ?? url,
  );

  useEffect(() => {
    if (type !== 'video') return;
    if (messageId) messageService.markPlayed(messageId); // « ouvert à … »
    // télécharge + garde en local pour les prochaines fois / hors-ligne
    void mediaCache.fetchNow(url).then((local) => {
      if (local) setVideoUri(local);
    });
  }, [type, url, messageId]);

  return (
    <View style={styles.root}>
      <Pressable
        onPress={() => navigation.goBack()}
        hitSlop={12}
        style={[styles.close, { top: insets.top + 8 }]}
      >
        <Icon name="close" size={26} color="#fff" />
      </Pressable>

      {type === 'image' ? (
        <CachedImage uri={url} forceDownload style={styles.image} resizeMode="contain" />
      ) : (
        <View style={styles.videoWrap}>
          {failed ? (
            <View style={styles.center}>
              <Icon name="alert-circle-outline" size={40} color="#ffffffaa" />
              <Text style={styles.hint}>{t('errors.generic')}</Text>
            </View>
          ) : (
            <>
              <Video
                ref={videoRef}
                source={{ uri: videoUri }}
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
                    <CachedImage
                      uri={thumbnailUrl}
                      style={StyleSheet.absoluteFill}
                      resizeMode="contain"
                    />
                  ) : null}
                  <ActivityIndicator color="#fff" size="large" />
                </View>
              ) : null}
            </>
          )}
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
});
