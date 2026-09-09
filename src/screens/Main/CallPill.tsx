/**
 * Pilule d'appel flottante — affichée en haut de l'écran quand l'appel est
 * réduit (`minimized`). Tap = revenir à l'écran d'appel plein écran.
 * Ne bloque pas la navigation en dessous.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { formatCallDuration, useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';

export const CallPill: React.FC = () => {
  const { call, phase, elapsed, muted, restore, hangUp, toggleMute } = useCall();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const anim = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 16, bounciness: 8 }).start();
  }, [anim]);

  // petit pouls sur l'indicateur pendant la sonnerie / connexion
  useEffect(() => {
    if (phase === 'active') {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [phase, pulse]);

  if (!call) return null;
  const name = call.peer?.display_name || call.peer?.username || t('calls.unknown');
  const status =
    phase === 'active'
      ? formatCallDuration(elapsed)
      : phase === 'outgoing'
        ? t('calls.ringing')
        : t('calls.connecting');

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + 6 }]} pointerEvents="box-none">
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: c.primary,
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-40, 0] }) },
            ],
          },
        ]}
      >
        <Pressable style={styles.main} onPress={restore} android_ripple={{ color: '#ffffff26' }}>
          <Animated.View
            style={[
              styles.dot,
              {
                backgroundColor: '#fff',
                opacity: phase === 'active' ? 1 : pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
              },
            ]}
          />
          <Icon
            name={call.callType === 'video' ? 'video' : 'phone-in-talk'}
            size={16}
            color="#fff"
          />
          <View style={styles.txt}>
            <Text style={styles.name} numberOfLines={1}>{name}</Text>
            <Text style={styles.status}>{status}</Text>
          </View>
          <Icon name="chevron-up" size={18} color="#ffffffcc" />
        </Pressable>

        <View style={styles.actions}>
          <Pressable
            onPress={() => void toggleMute()}
            style={[styles.act, muted && styles.actOn]}
            hitSlop={8}
          >
            <Icon name={muted ? 'microphone-off' : 'microphone'} size={16} color={muted ? c.primary : '#fff'} />
          </Pressable>
          <Pressable onPress={() => void hangUp()} style={[styles.act, styles.hang]} hitSlop={8}>
            <Icon name="phone-hangup" size={16} color="#fff" />
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { position: 'absolute', left: 0, right: 0, top: 0, alignItems: 'center', zIndex: 999, elevation: 999 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 24,
    paddingLeft: 14,
    paddingRight: 6,
    height: 48,
    maxWidth: '94%',
    elevation: 10,
    shadowColor: '#03081A',
    shadowOpacity: 0.3,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 5 },
  },
  main: { flexDirection: 'row', alignItems: 'center', gap: 8, flexShrink: 1, paddingRight: 6 },
  dot: { width: 7, height: 7, borderRadius: 4 },
  txt: { flexShrink: 1 },
  name: { color: '#fff', fontSize: 13.5, fontWeight: '800' },
  status: { color: '#ffffffcc', fontSize: 11, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: 6, marginLeft: 4 },
  act: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#ffffff26',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actOn: { backgroundColor: '#fff' },
  hang: { backgroundColor: '#E5484D' },
});
