/**
 * Menu ⋮ d'une conversation — feuille d'actions coulissante.
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

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

export interface ChatMenuAction {
  key: string;
  icon: string;
  label: string;
  danger?: boolean;
  onPress: () => void;
}

interface Props {
  visible: boolean;
  actions: ChatMenuAction[];
  onClose: () => void;
}

export const ChatMenuSheet: React.FC<Props> = ({ visible, actions, onClose }) => {
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
              paddingBottom: insets.bottom + 10,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [320, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.grabber} />
          {actions.map((a, i) => (
            <Pressable
              key={a.key}
              onPress={() => {
                onClose();
                // laisse la feuille se fermer avant l'action
                setTimeout(a.onPress, 120);
              }}
              android_ripple={{ color: c.surfaceAlt }}
              style={[
                styles.row,
                i < actions.length - 1 && {
                  borderBottomColor: c.divider,
                  borderBottomWidth: StyleSheet.hairlineWidth,
                },
              ]}
            >
              <Icon name={a.icon} size={21} color={a.danger ? c.danger : c.textMuted} />
              <Text style={[styles.label, { color: a.danger ? c.danger : c.text }]}>
                {a.label}
              </Text>
            </Pressable>
          ))}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.5)' },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 8,
    paddingHorizontal: 8,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 15 },
  label: { fontSize: 15.5, fontWeight: '500' },
});
