/**
 * Feuille coulissante d'emojis pour insérer un emoji dans le champ de texte
 * du chat (bouton emoji du composer, jusqu'ici décoratif — aucun clavier
 * emoji complet natif ici, juste une sélection courante façon liste rapide).
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { useTheme } from '@/context/ThemeContext';

interface Props {
  visible: boolean;
  onPick: (emoji: string) => void;
  onClose: () => void;
}

// Sélection courante, groupée par thème simple (pas un clavier emoji complet).
const EMOJIS = [
  '😀', '😂', '🤣', '😊', '😍', '😘', '😜', '🤔',
  '😎', '🥳', '😢', '😭', '😡', '😱', '🥺', '😴',
  '👍', '👎', '👏', '🙌', '🙏', '💪', '👌', '✌️',
  '❤️', '🔥', '💯', '✨', '🎉', '🎂', '⭐', '💔',
  '😷', '🤒', '🤗', '😅', '😉', '🙄', '😬', '🤩',
];

export const EmojiSheet: React.FC<Props> = ({ visible, onPick, onClose }) => {
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
          <Text style={[styles.title, { color: c.text }]}>{t('chat.emojiTitle')}</Text>
          <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              {EMOJIS.map((e, i) => (
                <Pressable
                  key={`${e}_${i}`}
                  onPress={() => onPick(e)}
                  android_ripple={{ color: c.surfaceAlt, borderless: true }}
                  style={styles.tile}
                  hitSlop={4}
                >
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
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
    maxHeight: 360,
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
  scroll: { maxHeight: 260 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, paddingBottom: 8 },
  tile: {
    width: '12.5%',
    aspectRatio: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emoji: { fontSize: 26 },
});
