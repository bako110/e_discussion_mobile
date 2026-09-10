/**
 * Toast discret — pilule flottante en bas de l'écran, disparaît toute seule.
 * Style iOS : légère, arrondie, une icône + un texte court.
 *
 * API impérative, appelable de partout :
 *
 *   import { showToast } from '@/components/common';
 *
 *   showToast('Paramètre enregistré');
 *   showToast('Échec', { type: 'error' });
 *
 * `<ToastHost />` doit être monté une fois au sommet de l'app.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';

import { Icon } from './Icon';

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  /** Durée d'affichage en ms (hors animations). Défaut : 2000. */
  duration?: number;
}

interface ToastItem extends Required<ToastOptions> {
  id: number;
  text: string;
}

type Emit = (item: ToastItem) => void;
let _emit: Emit | null = null;
let _seq = 0;
const _queue: ToastItem[] = [];

export function showToast(text: string, opts: ToastOptions = {}): void {
  const item: ToastItem = {
    id: ++_seq,
    text,
    type: opts.type ?? 'success',
    duration: opts.duration ?? 2000,
  };
  if (_emit) _emit(item);
  else _queue.push(item);
}

const ICON: Record<ToastType, string> = {
  success: 'check-circle',
  error: 'alert-circle',
  info: 'information',
};

export const ToastHost: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [current, setCurrent] = useState<ToastItem | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const pending = useRef<ToastItem[]>([]);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dismiss = useCallback(() => {
    Animated.timing(anim, {
      toValue: 0,
      duration: 160,
      easing: Easing.in(Easing.cubic),
      useNativeDriver: true,
    }).start(() => {
      const next = pending.current.shift();
      setCurrent(next ?? null);
    });
  }, [anim]);

  useEffect(() => {
    _emit = (item) => {
      setCurrent((cur) => {
        if (cur) {
          pending.current.push(item);
          return cur;
        }
        return item;
      });
    };
    if (_queue.length) {
      const [first, ...rest] = _queue.splice(0);
      pending.current.push(...rest);
      setCurrent(first);
    }
    return () => {
      _emit = null;
    };
  }, []);

  useEffect(() => {
    if (!current) return;
    anim.setValue(0);
    Animated.timing(anim, {
      toValue: 1,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
    hideTimer.current = setTimeout(dismiss, current.duration);
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [current, anim, dismiss]);

  if (!current) return null;

  const tint =
    current.type === 'success' ? c.success : current.type === 'error' ? c.danger : c.primary;

  return (
    <View style={[styles.root, { bottom: insets.bottom + 28 }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.pill,
          {
            backgroundColor: c.card,
            borderColor: c.divider,
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [16, 0],
                }),
              },
            ],
          },
        ]}
      >
        <Icon name={ICON[current.type]} size={18} color={tint} />
        <Text style={[styles.text, { color: c.text }]} numberOfLines={2}>
          {current.text}
        </Text>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
    maxWidth: '86%',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { fontSize: 14, fontWeight: '600', flexShrink: 1 },
});
