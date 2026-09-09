import React from 'react';
import {
  Image,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import type { MainScreenProps } from '@/navigation/types';
import { mediaUrl } from '@/utils/media';

/**
 * Visionneuse plein écran d'un média (image ou vidéo).
 *
 * Image : affichée en `contain`. Vidéo : miniature + bouton « lire » qui ouvre
 * le lecteur système (un lecteur intégré `react-native-video` pourra être
 * branché plus tard).
 */
export const MediaViewerScreen: React.FC<MainScreenProps<'MediaViewer'>> = ({
  route,
  navigation,
}) => {
  const { url, type, thumbnailUrl } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

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
        <Image source={{ uri: mediaUrl(url) }} style={styles.image} resizeMode="contain" />
      ) : (
        <View style={styles.videoWrap}>
          {thumbnailUrl ? (
            <Image source={{ uri: mediaUrl(thumbnailUrl) }} style={styles.image} resizeMode="contain" />
          ) : null}
          <Pressable style={styles.playBtn} onPress={() => Linking.openURL(mediaUrl(url) ?? url)}>
            <Icon name="play" size={34} color="#fff" />
          </Pressable>
          <Text style={styles.hint}>{t('media.openExternal')}</Text>
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
  playBtn: {
    position: 'absolute',
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  hint: { position: 'absolute', bottom: 60, color: '#ffffffcc', fontSize: 13 },
});
