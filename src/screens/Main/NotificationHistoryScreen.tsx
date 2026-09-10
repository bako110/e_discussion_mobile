/**
 * Historique des notifications — messages reçus + appels (entrants / manqués
 * / refusés). 100 % local (table `notifications`), consultable hors-ligne.
 *
 * Tap :
 *  - message -> ouvre la conversation ;
 *  - appel   -> rappelle le correspondant.
 * En-tête : « Tout marquer comme lu » + « Effacer ».
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  SectionList,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert } from '@/components/common';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import {
  notificationRepo,
  type LocalNotification,
} from '@/db/repositories/notificationRepo';
import type { MainNav } from '@/navigation/types';
import { userService } from '@/services';
import { refreshBadge } from '@/services/notificationService';
import { dayLabel, clockTime } from '@/utils/time';

interface Section {
  title: string;
  data: LocalNotification[];
}

function callIcon(n: LocalNotification): string {
  if (n.callResult === 'rejected') return 'phone-cancel';
  if (n.callResult === 'outgoing') return 'phone-outgoing';
  if (n.callResult === 'missed') return 'phone-missed';
  return 'phone-incoming';
}

export const NotificationHistoryScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { startCall } = useCall();
  const c = theme.colors;

  const [items, setItems] = useState<LocalNotification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const rows = await notificationRepo.list(200);
    setItems(rows);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    const off = notificationRepo.subscribe(() => void load());
    return off;
  }, [load]);

  // à l'ouverture : tout marquer lu (comme un centre de notifications)
  useEffect(() => {
    const timer = setTimeout(() => {
      void notificationRepo.markAllRead().then(() => refreshBadge());
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  const sections = useMemo<Section[]>(() => {
    const by = new Map<string, LocalNotification[]>();
    for (const n of items) {
      const key = dayLabel(n.createdAt);
      const arr = by.get(key) ?? [];
      arr.push(n);
      by.set(key, arr);
    }
    return [...by.entries()].map(([title, data]) => ({ title, data }));
  }, [items]);

  const openNotification = async (n: LocalNotification) => {
    void notificationRepo.markRead(n.id);
    if (n.kind === 'message' && n.conversationId) {
      const conv = await conversationRepo.get(n.conversationId).catch(() => null);
      navigation.navigate('Chat', {
        conversationId: n.conversationId,
        partnerId: conv?.partner.id ?? n.peerId ?? '',
        partnerName: conv?.partner.display_name || conv?.partner.username || n.title,
        partnerAvatar: conv?.partner.avatar_url ?? n.avatarUrl ?? null,
      });
      return;
    }
    if (n.kind === 'call' && n.peerId) {
      const peer = await userService.getById(n.peerId).catch(() => null);
      if (peer) startCall(peer, n.callType ?? 'voice').catch(() => undefined);
    }
  };

  const clearAll = () =>
    confirmAlert(
      t('notifHistory.clearTitle'),
      t('notifHistory.clearBody'),
      () => void notificationRepo.clearAll().then(() => refreshBadge()),
      { destructive: true, confirmText: t('common.delete') },
    );

  const renderRow = ({ item }: { item: LocalNotification }) => {
    const isCall = item.kind === 'call';
    return (
      <Pressable
        onPress={() => void openNotification(item)}
        style={[styles.row, !item.read && { backgroundColor: c.surfaceAlt }]}
        android_ripple={{ color: c.surfaceAlt }}
      >
        <View style={styles.avatarWrap}>
          <Avatar uri={item.avatarUrl} name={item.title} size={44} />
          <View
            style={[
              styles.badge,
              {
                backgroundColor:
                  isCall && item.callResult === 'missed'
                    ? c.danger
                    : isCall && item.callResult === 'rejected'
                      ? c.textMuted
                      : c.primary,
                borderColor: c.card,
              },
            ]}
          >
            <Icon
              name={isCall ? callIcon(item) : 'message-text'}
              size={11}
              color="#fff"
            />
          </View>
        </View>
        <View style={styles.body}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.preview, { color: c.textMuted }]} numberOfLines={1}>
            {item.body}
          </Text>
        </View>
        <View style={styles.meta}>
          <Text style={[styles.time, { color: c.textFaint }]}>
            {clockTime(item.createdAt)}
          </Text>
          {!item.read ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('notifHistory.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          items.length > 0 ? (
            <Pressable onPress={clearAll} hitSlop={12} style={styles.hdrBtn}>
              <Icon name="trash-can-outline" size={22} color={c.onHeader} />
            </Pressable>
          ) : undefined
        }
      />

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <Icon name="bell-outline" size={44} color={c.textFaint} />
          <Text style={[styles.emptyText, { color: c.textMuted }]}>
            {t('notifHistory.empty')}
          </Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(n) => n.id}
          renderItem={renderRow}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text style={[styles.section, { color: c.textFaint }]}>{section.title}</Text>
          )}
          contentContainerStyle={styles.list}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  list: { paddingBottom: 32 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  avatarWrap: { width: 44, height: 44 },
  badge: {
    position: 'absolute',
    right: -3,
    bottom: -3,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  name: { fontSize: 15.5, fontWeight: '600' },
  preview: { fontSize: 13, marginTop: 2 },
  meta: { alignItems: 'flex-end', gap: 6 },
  time: { fontSize: 11 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, padding: 32 },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
