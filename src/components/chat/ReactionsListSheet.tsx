/**
 * Bottom sheet "qui a réagi" — ouverte au TAP sur un compteur de réaction
 * d'un message de groupe/chaîne/canal (façon Instagram/Facebook). Liste
 * avatar + nom de chaque personne, groupés par emoji.
 *
 * Chargement à l'ouverture uniquement (pas de cache local, potentiellement
 * volumineux et jamais consulté hors-ligne) — voir
 * `groupService.listMessageReactions`.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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

import { Avatar } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { groupService } from '@/services';
import type { GroupMessageReaction } from '@/types';

interface Props {
  visible: boolean;
  groupId: string | null;
  messageId: string | null;
  onClose: () => void;
}

export const ReactionsListSheet: React.FC<Props> = ({ visible, groupId, messageId, onClose }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const anim = useRef(new Animated.Value(0)).current;
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<GroupMessageReaction[]>([]);

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: visible ? 220 : 160,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  useEffect(() => {
    if (!visible || !groupId || !messageId) return;
    setLoading(true);
    void groupService
      .listMessageReactions(groupId, messageId)
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [visible, groupId, messageId]);

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
              paddingBottom: insets.bottom + 16,
              transform: [
                { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [420, 0] }) },
              ],
              maxHeight: '70%',
            },
          ]}
        >
          <View style={styles.grabber} />
          <Text style={[styles.title, { color: c.text }]}>{t('chat.reactionsListTitle')}</Text>

          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : items.length === 0 ? (
            <View style={styles.center}>
              <Text style={{ color: c.textMuted }}>{t('chat.reactionsListEmpty')}</Text>
            </View>
          ) : (
            items.map((r, i) => (
              <View key={`${r.user.id}-${i}`} style={styles.row}>
                <Avatar uri={r.user.avatar_url} name={r.user.display_name || r.user.username} size={40} />
                <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                  {r.user.display_name || r.user.username || '—'}
                </Text>
                <Text style={styles.rowEmoji}>{r.emoji}</Text>
              </View>
            ))
          )}
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(6,12,28,0.55)' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 12,
    paddingTop: 10,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(140,150,170,0.4)',
    marginBottom: 14,
  },
  title: {
    fontSize: 13,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
    marginLeft: 10,
  },
  center: { paddingVertical: 24, alignItems: 'center' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  rowName: { flex: 1, fontSize: 15, fontWeight: '600' },
  rowEmoji: { fontSize: 18 },
});
