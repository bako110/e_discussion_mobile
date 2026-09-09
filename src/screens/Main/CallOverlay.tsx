/**
 * Overlay plein écran affiché au-dessus de toute la navigation quand un appel
 * est en cours (entrant, sortant ou actif). Monté par le RootNavigator.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';

import { ActiveCallScreen } from './ActiveCallScreen';
import { CallPill } from './CallPill';
import { IncomingCallScreen } from './IncomingCallScreen';

/** Petite carte affichée ~1,6 s après la fin d'un appel non abouti
 *  (occupé, refusé, manqué…) quand il n'y a plus d'écran d'appel à montrer. */
const EndToast: React.FC = () => {
  const { endReason } = useCall();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.spring(anim, { toValue: 1, useNativeDriver: true, speed: 14, bounciness: 6 }).start();
  }, [anim]);

  const map: Record<string, { icon: string; label: string; tint: string }> = {
    busy: { icon: 'phone-in-talk', label: t('calls.peerBusy'), tint: c.danger },
    declined: { icon: 'phone-cancel', label: t('calls.declined'), tint: c.textMuted },
    missed: { icon: 'phone-missed', label: t('calls.noAnswer'), tint: c.danger },
    failed: { icon: 'phone-alert', label: t('calls.failed'), tint: c.danger },
    cancelled: { icon: 'phone-hangup', label: t('calls.ended'), tint: c.textMuted },
    ended: { icon: 'phone-hangup', label: t('calls.ended'), tint: c.textMuted },
  };
  const m = map[endReason ?? 'ended'] ?? map.ended;

  return (
    <View style={[styles.toastWrap, { paddingTop: insets.top + 12 }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.toast,
          {
            backgroundColor: c.card,
            borderColor: c.divider,
            opacity: anim,
            transform: [
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [-20, 0] }) },
            ],
          },
        ]}
      >
        <View style={[styles.toastIcon, { backgroundColor: m.tint + '22' }]}>
          <Icon name={m.icon} size={18} color={m.tint} />
        </View>
        <Text style={[styles.toastText, { color: c.text }]}>{m.label}</Text>
      </Animated.View>
    </View>
  );
};

export const CallOverlay: React.FC = () => {
  const { phase, call, minimized } = useCall();

  if (phase === 'idle') return null;

  // fin d'appel sans écran à montrer (occupé / refusé avant décroché) : toast
  if (phase === 'ended' && !call) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <EndToast />
      </View>
    );
  }

  // appel entrant : toujours plein écran
  if (phase === 'incoming') {
    return (
      <View style={StyleSheet.absoluteFill}>
        <IncomingCallScreen />
      </View>
    );
  }

  // appel réduit : pilule flottante, la navigation dessous reste utilisable
  if (minimized) {
    return (
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <CallPill />
      </View>
    );
  }

  return (
    <View style={StyleSheet.absoluteFill}>
      <ActiveCallScreen />
    </View>
  );
};

const styles = StyleSheet.create({
  toastWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 8,
    shadowColor: '#0A1730',
    shadowOpacity: 0.2,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 6 },
  },
  toastIcon: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  toastText: { fontSize: 14, fontWeight: '700' },
});
