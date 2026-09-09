/**
 * Menu « + » du composer — feuille coulissante pour joindre un média :
 * photo (galerie / caméra), vidéo, document, position.
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

export type AttachKind = 'gallery' | 'camera' | 'video' | 'file' | 'location';

interface Props {
  visible: boolean;
  onPick: (kind: AttachKind) => void;
  onClose: () => void;
}

interface Tile {
  kind: AttachKind;
  icon: string;
  labelKey: string;
  tint: string;
}

const TILES: Tile[] = [
  { kind: 'gallery', icon: 'image-multiple', labelKey: 'chat.attachPhoto', tint: '#7C5CFF' },
  { kind: 'camera', icon: 'camera', labelKey: 'chat.attachCamera', tint: '#E8477E' },
  { kind: 'video', icon: 'video', labelKey: 'chat.attachVideo', tint: '#F0913A' },
  { kind: 'file', icon: 'file-document', labelKey: 'chat.attachFile', tint: '#3AA0F0' },
  { kind: 'location', icon: 'map-marker', labelKey: 'chat.attachLocation', tint: '#28B463' },
];

export const AttachMenu: React.FC<Props> = ({ visible, onPick, onClose }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 200 : 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  const run = (kind: AttachKind) => {
    onClose();
    setTimeout(() => onPick(kind), 120);
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <View style={styles.root}>
        <Animated.View style={[styles.backdrop, { opacity: anim }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        </Animated.View>
        <Animated.View
          style={[
            styles.sheet,
            {
              backgroundColor: c.card,
              paddingBottom: insets.bottom + 18,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.grabber} />
          <Text style={[styles.title, { color: c.text }]}>{t('chat.attachTitle')}</Text>
          <View style={styles.grid}>
            {TILES.map((tile) => (
              <Pressable
                key={tile.kind}
                onPress={() => run(tile.kind)}
                android_ripple={{ color: c.surfaceAlt, borderless: true }}
                style={styles.tile}
              >
                <View style={[styles.iconWrap, { backgroundColor: tile.tint }]}>
                  <Icon name={tile.icon} size={24} color="#fff" />
                </View>
                <Text style={[styles.tileLabel, { color: c.textMuted }]} numberOfLines={1}>
                  {t(tile.labelKey)}
                </Text>
              </Pressable>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.5)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingTop: 8,
    paddingHorizontal: 16,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 12,
  },
  title: { fontSize: 15, fontWeight: '800', marginBottom: 14, marginLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '18%', alignItems: 'center', gap: 7, paddingVertical: 4 },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: { fontSize: 11, fontWeight: '600' },
});
