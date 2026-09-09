import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showAlert } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { callService } from '@/services';
import type { CallLog } from '@/types';
import { dayLabel } from '@/utils/time';

/** Onglet Appels — historique réel (GET /calls) + rappel en 1 tap. */
export const CallsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<MainNav>();
  const { me } = useAuth();
  const { available, startCall, phase } = useCall();
  const c = theme.colors;

  const [items, setItems] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const rows = await callService.history(1, 60);
      setItems(rows);
    } catch {
      /* hors-ligne : on garde l'existant */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const goBack = () => navigation.navigate('Tabs', { screen: 'ChatsTab' });
  const newCall = () => navigation.navigate('NewConversation', { mode: 'call' });

  const redial = (log: CallLog) => {
    if (!log.peer) return;
    if (!available) {
      showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    if (phase !== 'idle') return;
    startCall(log.peer, log.call_type).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : t('calls.startFailed');
      showAlert(t('calls.startFailed'), msg);
    });
  };

  const clearAll = () => {
    if (items.length === 0) return;
    showAlert(t('calls.clearTitle'), t('calls.clearBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: () => {
          setItems([]);
          void callService.clear().catch(() => void load());
        },
      },
    ]);
  };

  const renderItem = ({ item }: { item: CallLog }) => {
    const name = item.peer?.display_name || item.peer?.username || t('calls.unknown');
    const missed = item.status === 'missed' || item.status === 'rejected' || item.status === 'cancelled';
    const inbound = item.callee_id === me?.id;

    const dirColor = missed ? c.danger : c.textMuted;
    const arrow = inbound
      ? missed
        ? 'phone-missed'
        : 'phone-incoming'
      : 'phone-outgoing';

    return (
      <Pressable
        style={styles.row}
        android_ripple={{ color: c.surfaceAlt }}
        onPress={() => redial(item)}
      >
        <Avatar uri={item.peer?.avatar_url} name={name} size={48} />
        <View style={styles.rowBody}>
          <Text
            style={[styles.rowName, { color: missed ? c.danger : c.text }]}
            numberOfLines={1}
          >
            {name}
          </Text>
          <View style={styles.rowMeta}>
            <Icon name={arrow} size={14} color={dirColor} />
            <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
              {statusLabel(item, t)} · {dayLabel(item.started_at)}
            </Text>
          </View>
        </View>
        <Pressable hitSlop={10} onPress={() => redial(item)} style={styles.rowCall}>
          <Icon
            name={item.call_type === 'video' ? 'video-outline' : 'phone-outline'}
            size={22}
            color={c.primary}
          />
        </Pressable>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('calls.title')}
        left={
          <Pressable onPress={goBack} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          <View style={styles.hdrRight}>
            {items.length > 0 ? (
              <Pressable onPress={clearAll} hitSlop={12} style={styles.hdrBtn}>
                <Icon name="trash-can-outline" size={20} color={c.onHeader} />
              </Pressable>
            ) : null}
            <Pressable onPress={newCall} hitSlop={12} style={styles.hdrBtn}>
              <Icon name="phone-plus" size={22} color={c.onHeader} />
            </Pressable>
          </View>
        }
      />

      {!available ? (
        <View style={[styles.banner, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="information-outline" size={16} color={c.textMuted} />
          <Text style={[styles.bannerText, { color: c.textMuted }]}>
            {t('calls.unavailableBody')}
          </Text>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : items.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.iconCircle, { backgroundColor: c.surfaceAlt }]}>
            <Icon name="phone-outline" size={40} color={c.textFaint} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>{t('calls.empty')}</Text>
          <Text style={[styles.sub, { color: c.textMuted }]}>{t('calls.emptyHint')}</Text>
          <Pressable
            onPress={newCall}
            style={[styles.cta, { backgroundColor: c.primary }]}
            android_ripple={{ color: '#ffffff30' }}
          >
            <Icon name="phone-plus" size={18} color="#fff" />
            <Text style={styles.ctaText}>{t('calls.newCall')}</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(it) => it.id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load();
              }}
              tintColor={c.primary}
            />
          }
        />
      )}
    </Screen>
  );
};

function statusLabel(
  log: CallLog,
  t: (k: string, o?: Record<string, unknown>) => string,
): string {
  switch (log.status) {
    case 'missed':
      return t('calls.statusMissed');
    case 'rejected':
      return t('calls.statusRejected');
    case 'cancelled':
      return t('calls.statusCancelled');
    case 'failed':
      return t('calls.statusFailed');
    default: {
      const s = Math.max(0, log.duration_sec);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m > 0 ? `${m} min ${r}s` : `${r}s`;
    }
  }
}

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  hdrRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  bannerText: { fontSize: 12, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowSub: { fontSize: 13, flex: 1 },
  rowCall: { padding: 6 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  iconCircle: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700' },
  sub: { fontSize: 14, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 16,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
