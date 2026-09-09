/**
 * Système d'alerte maison — remplace `Alert.alert` avec un design cohérent
 * (carte centrée, animation spring, icône par type, boutons stylés).
 *
 * Usage impératif, appelable de PARTOUT (composants, hooks, services) :
 *
 *   import { showAlert } from '@/components/common';
 *
 *   showAlert('Titre', 'Message');
 *   showAlert('Supprimer ?', 'Action irréversible.', [
 *     { text: 'Annuler', style: 'cancel' },
 *     { text: 'Supprimer', style: 'destructive', onPress: doDelete },
 *   ]);
 *   showAlert({ type: 'success', title: 'Enregistré' });
 *
 * `<AppAlertHost />` doit être monté une fois au sommet de l'app (RootNavigator).
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

// ── types ───────────────────────────────────────────────────────────────────
export type AlertType = 'info' | 'success' | 'warning' | 'danger' | 'none';
export type AlertButtonStyle = 'default' | 'cancel' | 'destructive';

export interface AlertButton {
  text: string;
  style?: AlertButtonStyle;
  onPress?: () => void;
}

export interface AlertOptions {
  title: string;
  message?: string;
  type?: AlertType;
  buttons?: AlertButton[];
  /** false = ne pas fermer en touchant le fond / retour Android. */
  dismissable?: boolean;
}

// ── API impérative ──────────────────────────────────────────────────────────
type Emit = (opts: AlertOptions) => void;
let _emit: Emit | null = null;
const _queue: AlertOptions[] = [];

/** Signature compatible `Alert.alert` + surcharge objet. */
export function showAlert(
  a: string | AlertOptions,
  message?: string,
  buttons?: AlertButton[],
  type?: AlertType,
): void {
  const opts: AlertOptions =
    typeof a === 'string' ? { title: a, message, buttons, type } : a;
  if (_emit) _emit(opts);
  else _queue.push(opts); // host pas encore monté -> file d'attente
}

/** Raccourcis. */
export const alertSuccess = (title: string, message?: string) =>
  showAlert({ title, message, type: 'success' });
export const alertError = (title: string, message?: string) =>
  showAlert({ title, message, type: 'danger' });
export const confirmAlert = (
  title: string,
  message: string,
  onConfirm: () => void,
  opts?: { confirmText?: string; destructive?: boolean; cancelText?: string },
) =>
  showAlert({
    title,
    message,
    type: opts?.destructive ? 'danger' : 'warning',
    buttons: [
      { text: opts?.cancelText ?? 'Annuler', style: 'cancel' },
      {
        text: opts?.confirmText ?? 'Confirmer',
        style: opts?.destructive ? 'destructive' : 'default',
        onPress: onConfirm,
      },
    ],
  });

// ── host (rendu) ────────────────────────────────────────────────────────────
const ICONS: Record<AlertType, string> = {
  info: 'information',
  success: 'check-circle',
  warning: 'alert',
  danger: 'alert-octagon',
  none: '',
};

export const AppAlertHost: React.FC = () => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [current, setCurrent] = useState<AlertOptions | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const pending = useRef<AlertOptions[]>([]);

  const close = useCallback(
    (cb?: () => void) => {
      Animated.timing(anim, {
        toValue: 0,
        duration: 140,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(() => {
        cb?.();
        // enchaîne l'alerte suivante s'il y en a une
        const next = pending.current.shift();
        if (next) {
          setCurrent(next);
        } else {
          setCurrent(null);
        }
      });
    },
    [anim],
  );

  // branche l'API impérative
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
    // vide la file accumulée avant le montage
    if (_queue.length) {
      const [first, ...rest] = _queue.splice(0);
      pending.current.push(...rest);
      setCurrent(first);
    }
    return () => {
      _emit = null;
    };
  }, []);

  // animation d'entrée à chaque nouvelle alerte
  useEffect(() => {
    if (current) {
      anim.setValue(0);
      Animated.spring(anim, {
        toValue: 1,
        useNativeDriver: true,
        speed: 16,
        bounciness: 8,
      }).start();
    }
  }, [current, anim]);

  // retour Android ferme l'alerte (si dismissable)
  useEffect(() => {
    if (!current) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (current.dismissable !== false) {
        const cancelBtn = current.buttons?.find((b) => b.style === 'cancel');
        close(cancelBtn?.onPress);
      }
      return true;
    });
    return () => sub.remove();
  }, [current, close]);

  if (!current) return null;

  const type: AlertType = current.type ?? 'info';
  const buttons: AlertButton[] =
    current.buttons && current.buttons.length > 0
      ? current.buttons
      : [{ text: 'OK', style: 'default' }];
  const tint =
    type === 'success'
      ? c.success
      : type === 'danger'
        ? c.danger
        : type === 'warning'
          ? c.warning
          : c.primary;

  const onBackdrop = () => {
    if (current.dismissable === false) return;
    const cancelBtn = current.buttons?.find((b) => b.style === 'cancel');
    close(cancelBtn?.onPress);
  };

  // disposition des boutons : 2 boutons courts -> ligne ; sinon colonne
  const inRow =
    buttons.length === 2 && buttons.every((b) => (b.text?.length ?? 0) <= 14);

  return (
    <View style={styles.root} pointerEvents="box-none">
      <Animated.View
        style={[styles.backdrop, { opacity: anim }]}
        pointerEvents="auto"
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={onBackdrop} />
      </Animated.View>

      <Animated.View
        style={[
          styles.card,
          {
            backgroundColor: c.card,
            marginBottom: insets.bottom,
            opacity: anim,
            transform: [
              { scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
              { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
            ],
          },
        ]}
      >
        {type !== 'none' ? (
          <View style={[styles.iconWrap, { backgroundColor: tint + '1A' }]}>
            <Icon name={ICONS[type]} size={26} color={tint} />
          </View>
        ) : null}

        <Text style={[styles.title, { color: c.text }]}>{current.title}</Text>
        {current.message ? (
          <Text style={[styles.message, { color: c.textMuted }]}>{current.message}</Text>
        ) : null}

        <View style={[styles.actions, inRow ? styles.actionsRow : styles.actionsCol]}>
          {buttons.map((b, i) => {
            const destructive = b.style === 'destructive';
            const cancel = b.style === 'cancel';
            return (
              <Pressable
                key={`${b.text}-${i}`}
                onPress={() => close(b.onPress)}
                android_ripple={{ color: cancel ? c.surfaceAlt : '#ffffff30' }}
                style={[
                  styles.btn,
                  inRow ? styles.btnFlex : styles.btnFull,
                  cancel
                    ? [styles.btnCancel, { backgroundColor: c.surfaceAlt }]
                    : { backgroundColor: destructive ? c.danger : c.primary },
                ]}
              >
                <Text
                  style={[
                    styles.btnText,
                    { color: cancel ? c.text : '#fff' },
                  ]}
                  numberOfLines={1}
                >
                  {b.text}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </Animated.View>
    </View>
  );
};

// ── styles (tailles cohérentes) ─────────────────────────────────────────────
const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
    elevation: 9999,
  },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.55)' },
  card: {
    width: '84%',
    maxWidth: 360,
    borderRadius: 22,
    padding: 22,
    alignItems: 'center',
    gap: 10,
    elevation: 18,
    shadowColor: '#03081A',
    shadowOpacity: 0.35,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
  },
  iconWrap: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 2,
  },
  title: { fontSize: 17.5, fontWeight: '800', textAlign: 'center', letterSpacing: -0.3 },
  message: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  actions: { width: '100%', marginTop: 12 },
  actionsRow: { flexDirection: 'row', gap: 10 },
  actionsCol: { flexDirection: 'column-reverse', gap: 8 },
  btn: {
    height: 46,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  btnFlex: { flex: 1 },
  btnFull: { width: '100%' },
  btnCancel: {},
  btnText: { fontSize: 15, fontWeight: '700' },
});
