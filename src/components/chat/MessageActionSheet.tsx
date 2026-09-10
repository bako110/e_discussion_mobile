/**
 * Feuille d'actions sur un message (appui long) : rangée d'émojis de
 * réaction + Répondre / Copier / Modifier / Transférer / Supprimer.
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

export const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

export interface MsgActionContext {
  mine: boolean;
  hasText: boolean;
  encrypted: boolean;
  currentReaction: string | null;
}

interface Props {
  visible: boolean;
  ctx: MsgActionContext | null;
  onReact: (emoji: string | null) => void;
  onReply: () => void;
  onCopy: () => void;
  onEdit: () => void;
  onForward: () => void;
  onInfo: () => void;
  onDeleteForMe: () => void;
  onDeleteForEveryone: () => void;
  onClose: () => void;
}

export const MessageActionSheet: React.FC<Props> = ({
  visible,
  ctx,
  onReact,
  onReply,
  onCopy,
  onEdit,
  onForward,
  onInfo,
  onDeleteForMe,
  onDeleteForEveryone,
  onClose,
}) => {
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

  if (!ctx && !visible) return null;

  const run = (fn: () => void) => {
    onClose();
    setTimeout(fn, 110);
  };

  const rows: { key: string; icon: string; label: string; danger?: boolean; show: boolean; fn: () => void }[] = [
    { key: 'reply', icon: 'reply', label: t('chat.reply'), show: true, fn: () => run(onReply) },
    { key: 'copy', icon: 'content-copy', label: t('chat.copy'), show: !!ctx?.hasText, fn: () => run(onCopy) },
    { key: 'edit', icon: 'pencil-outline', label: t('common.edit'), show: !!ctx?.mine && !!ctx?.hasText && !ctx?.encrypted, fn: () => run(onEdit) },
    { key: 'forward', icon: 'share-outline', label: t('chat.forward'), show: !!ctx?.hasText, fn: () => run(onForward) },
    { key: 'info', icon: 'information-outline', label: t('messageInfo.action'), show: !!ctx?.mine, fn: () => run(onInfo) },
    { key: 'delme', icon: 'trash-can-outline', label: t('chat.deleteForMe'), show: true, fn: () => run(onDeleteForMe) },
    { key: 'delall', icon: 'trash-can', label: t('chat.deleteForEveryone'), danger: true, show: !!ctx?.mine, fn: () => run(onDeleteForEveryone) },
  ];

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
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [340, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.grabber} />

          {/* rangée d'émojis */}
          <View style={styles.emojiRow}>
            {QUICK_REACTIONS.map((e) => {
              const on = ctx?.currentReaction === e;
              return (
                <Pressable
                  key={e}
                  onPress={() => run(() => onReact(on ? null : e))}
                  style={[styles.emojiBtn, on && { backgroundColor: c.primary + '22' }]}
                >
                  <Text style={styles.emoji}>{e}</Text>
                </Pressable>
              );
            })}
          </View>

          {rows
            .filter((r) => r.show)
            .map((r, i, arr) => (
              <Pressable
                key={r.key}
                onPress={r.fn}
                android_ripple={{ color: c.surfaceAlt }}
                style={[
                  styles.action,
                  i < arr.length - 1 && {
                    borderBottomColor: c.divider,
                    borderBottomWidth: StyleSheet.hairlineWidth,
                  },
                ]}
              >
                <Icon name={r.icon} size={20} color={r.danger ? c.danger : c.textMuted} />
                <Text style={[styles.actionLabel, { color: r.danger ? c.danger : c.text }]}>
                  {r.label}
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
  emojiRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingHorizontal: 8,
    paddingVertical: 8,
    marginBottom: 4,
  },
  emojiBtn: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  emoji: { fontSize: 24 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 14, paddingVertical: 14 },
  actionLabel: { fontSize: 15.5, fontWeight: '500' },
});
