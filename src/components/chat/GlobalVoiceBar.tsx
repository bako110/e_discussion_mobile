/**
 * Mini-lecteur de note vocale GLOBAL — bandeau fin ancré en haut de l'écran,
 * sous le header. Apparaît quand une note vocale joue ET qu'on n'est PAS dans
 * la conversation d'origine (là, c'est la bulle qui affiche la lecture).
 * Boutons : pause / reprise, et ✕ pour fermer (stoppe la lecture). Façon
 * WhatsApp.
 *
 * Monté une seule fois par le RootNavigator, au-dessus de la navigation.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { activeThreadId, navigationRef } from '@/navigation/navigationRef';
import {
  getVoiceState,
  pauseVoice,
  resumeVoice,
  stopVoice,
  subscribeVoice,
} from '@/services/voicePlayer';

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

export const GlobalVoiceBar: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const insets = useSafeAreaInsets();

  const [, force] = useState(0);
  const bump = () => force((n) => n + 1);
  useEffect(() => subscribeVoice(bump), []);
  // la barre dépend aussi de la route active (visible hors du chat d'origine)
  useEffect(() => {
    if (!navigationRef.isReady()) return;
    const unsub = navigationRef.addListener('state', bump);
    return unsub;
  }, []);

  const vp = getVoiceState();
  // visible : une note est chargée ET on n'est pas dans son fil d'origine
  const visible = !!vp.url && activeThreadId() !== vp.conversationId;

  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(slide, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, slide]);

  if (!vp.url && !visible) return null;

  const progress =
    vp.duration > 0 ? Math.min(1, vp.position / vp.duration) : 0;
  const remain = vp.duration > 0 ? vp.duration - vp.position : 0;

  return (
    <Animated.View
      pointerEvents={visible ? 'auto' : 'none'}
      style={[
        styles.wrap,
        {
          top: insets.top + 6,
          opacity: slide,
          transform: [
            { translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [-60, 0] }) },
          ],
        },
      ]}
    >
      <View style={[styles.bar, { backgroundColor: c.surface, borderColor: c.border }]}>
        <Pressable
          onPress={() => void (vp.playing ? pauseVoice() : resumeVoice())}
          hitSlop={8}
          style={[styles.iconBtn, { backgroundColor: c.primary + '1F' }]}
        >
          <Icon name={vp.playing ? 'pause' : 'play'} size={18} color={c.primary} />
        </Pressable>

        <View style={styles.mid}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {vp.title || t('chat.voiceNote')}
          </Text>
          <View style={[styles.track, { backgroundColor: c.border }]}>
            <View
              style={[styles.fill, { backgroundColor: c.primary, width: `${progress * 100}%` }]}
            />
          </View>
        </View>

        <Text style={[styles.time, { color: c.textMuted }]}>{fmt(remain)}</Text>

        <Pressable onPress={() => void stopVoice()} hitSlop={8} style={styles.closeBtn}>
          <Icon name="close" size={18} color={c.textMuted} />
        </Pressable>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 10, right: 10, zIndex: 50 },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 14,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#0A1730',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
  },
  iconBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  mid: { flex: 1, gap: 5 },
  title: { fontSize: 13, fontWeight: '700', letterSpacing: -0.2 },
  track: { height: 3, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 3, borderRadius: 2 },
  time: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
  closeBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
});
