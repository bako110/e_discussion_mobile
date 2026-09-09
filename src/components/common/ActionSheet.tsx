/**
 * Feuille d'actions glissante (bottom sheet) — style WhatsApp.
 *
 * Pour les MENUS DE CHOIX (3+ options, « Photo / Vidéo / Document », filtres…).
 * Les simples confirmations Oui/Non restent sur `showAlert` (carte centrée).
 *
 * API impérative, appelable de partout :
 *
 *   import { showSheet } from '@/components/common';
 *
 *   showSheet({
 *     title: 'Joindre',
 *     actions: [
 *       { label: 'Photo',   icon: 'image',  onPress: pickPhoto },
 *       { label: 'Vidéo',   icon: 'video',  onPress: pickVideo },
 *       { label: 'Supprimer', icon: 'trash-can', destructive: true, onPress: del },
 *     ],
 *   });
 *
 * `<ActionSheetHost />` doit être monté une fois au sommet de l'app.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  BackHandler,
  Easing,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';

import { Icon } from './Icon';

export interface SheetAction {
  label: string;
  /** Nom d'icône MaterialCommunityIcons (optionnel). */
  icon?: string;
  destructive?: boolean;
  /** Grisé / non cliquable. */
  disabled?: boolean;
  onPress?: () => void;
}

export interface SheetOptions {
  title?: string;
  message?: string;
  actions: SheetAction[];
  /** Libellé du bouton d'annulation (bloc séparé en bas). `null` = pas de bouton. */
  cancelLabel?: string | null;
  onCancel?: () => void;
}

type Emit = (opts: SheetOptions) => void;
let _emit: Emit | null = null;
const _queue: SheetOptions[] = [];

export function showSheet(opts: SheetOptions): void {
  if (_emit) _emit(opts);
  else _queue.push(opts);
}

export const ActionSheetHost: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [current, setCurrent] = useState<SheetOptions | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const pending = useRef<SheetOptions[]>([]);

  const close = useCallback(
    (cb?: () => void) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 160,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        cb?.();
        const next = pending.current.shift();
        setCurrent(next ?? null);
      });
    },
    [anim],
  );

  useEffect(() => {
    _emit = (opts) => {
      setCurrent((cur) => {
        if (cur) {
          pending.current.push(opts);
          return cur;
        }
        return opts;
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
    if (current) {
      anim.setValue(0);
      Animated.timing(anim, {
        toValue: 1,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }).start();
    }
  }, [current, anim]);

  useEffect(() => {
    if (!current) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close(current.onCancel);
      return true;
    });
    return () => sub.remove();
  }, [current, close]);

  if (!current) return null;

  const showCancel = current.cancelLabel !== null;
  const cancelText = current.cancelLabel ?? 'Annuler';

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View style={[styles.backdrop, { opacity: anim }]} pointerEvents="auto">
        <Pressable style={StyleSheet.absoluteFill} onPress={() => close(current.onCancel)} />
      </Animated.View>

      <Animated.View
        style={[
          styles.wrap,
          {
            paddingBottom: insets.bottom + 8,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [400, 0],
                }),
              },
            ],
          },
        ]}
      >
        <View style={[styles.sheet, { backgroundColor: c.card }]}>
          <View style={styles.grabber} />
          {current.title || current.message ? (
            <View style={styles.header}>
              {current.title ? (
                <Text style={[styles.title, { color: c.text }]}>{current.title}</Text>
              ) : null}
              {current.message ? (
                <Text style={[styles.message, { color: c.textMuted }]}>{current.message}</Text>
              ) : null}
            </View>
          ) : null}

          {current.actions.map((a, i) => (
            <Pressable
              key={`${a.label}-${i}`}
              disabled={a.disabled}
              onPress={() => close(a.onPress)}
              android_ripple={{ color: c.surfaceAlt }}
              style={[
                styles.row,
                i < current.actions.length - 1 && {
                  borderBottomColor: c.divider,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
                a.disabled && { opacity: 0.4 },
              ]}
            >
              {a.icon ? (
                <Icon
                  name={a.icon}
                  size={22}
                  color={a.destructive ? c.danger : c.textMuted}
                />
              ) : (
                <View style={styles.iconSpace} />
              )}
              <Text
                style={[
                  styles.rowLabel,
                  { color: a.destructive ? c.danger : c.text },
                ]}
              >
                {a.label}
              </Text>
            </Pressable>
          ))}
        </View>

        {showCancel ? (
          <Pressable
            onPress={() => close(current.onCancel)}
            android_ripple={{ color: c.surfaceAlt }}
            style={[styles.cancel, { backgroundColor: c.card }]}
          >
            <Text style={[styles.cancelText, { color: c.primary }]}>{cancelText}</Text>
          </Pressable>
        ) : null}
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', zIndex: 9998, elevation: 9998 },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.5)' },
  wrap: { paddingHorizontal: 8, gap: 8 },
  sheet: {
    borderRadius: 20,
    paddingTop: 8,
    overflow: 'hidden',
  },
  grabber: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 6,
  },
  header: {
    paddingHorizontal: 18,
    paddingTop: 6,
    paddingBottom: 12,
    borderBottomColor: 'rgba(140,150,170,0.18)',
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { fontSize: 13, fontWeight: '700', letterSpacing: 0.2, textTransform: 'uppercase', opacity: 0.7 },
  message: { fontSize: 13.5, lineHeight: 19, marginTop: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
    paddingHorizontal: 20,
    paddingVertical: 16,
  },
  iconSpace: { width: 22 },
  rowLabel: { fontSize: 16, fontWeight: '500' },
  cancel: {
    borderRadius: 20,
    paddingVertical: 17,
    alignItems: 'center',
  },
  cancelText: { fontSize: 16, fontWeight: '700' },
});
