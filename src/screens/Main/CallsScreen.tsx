import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showAlert } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';
import { BAR_HEIGHT } from '@/navigation/TabNavigator';
import type { MainNav } from '@/navigation/types';
import { callService } from '@/services';
import type { CallLog } from '@/types';
import { callStartErrorMessage } from '@/utils/callError';
import { clockTime, dayLabel } from '@/utils/time';
import { CallSearchSheet, type CallDateFilter } from './CallSearchSheet';

type Filter = 'all' | 'missed' | 'incoming' | 'outgoing' | 'video';

const FILTERS: { key: Filter; icon: string }[] = [
  { key: 'all', icon: 'phone' },
  { key: 'missed', icon: 'phone-missed' },
  { key: 'incoming', icon: 'phone-incoming' },
  { key: 'outgoing', icon: 'phone-outgoing' },
  { key: 'video', icon: 'video' },
];

type Row =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'call'; key: string; log: CallLog };

/** Onglet Appels — historique (GET /calls) : filtres, groupé par jour,
 *  suppression individuelle (swipe), rappel en 1 tap, heure d'appel. */
export const CallsScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const navigation = useNavigation<MainNav>();
  const { me } = useAuth();
  const { available, startCall, phase } = useCall();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [items, setItems] = useState<CallLog[]>(() => callService.readHistoryCache());
  const [loading, setLoading] = useState(() => callService.readHistoryCache().length === 0);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [searchOpen, setSearchOpen] = useState(false);
  const [dateFilter, setDateFilter] = useState<CallDateFilter | null>(null);
  const openRow = useRef<Swipeable | null>(null);

  const load = useCallback(async () => {
    // 1) cache local d'abord (instantané, hors-ligne OK)
    setItems(callService.readHistoryCache());
    setLoading(false);
    // 2) rafraîchit depuis le serveur si possible
    try {
      setItems(await callService.history(1, 100));
    } catch {
      /* hors-ligne : on garde le cache local affiché */
    } finally {
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
  const openSettings = () => navigation.navigate('CallsSettings');

  const isMissed = (l: CallLog) =>
    l.status === 'missed' || l.status === 'rejected' || l.status === 'cancelled';

  const filtered = useMemo(() => {
    return items.filter((l) => {
      const inbound = l.callee_id === me?.id;
      switch (filter) {
        case 'missed':
          if (!(isMissed(l) && inbound)) return false;
          break;
        case 'incoming':
          if (!inbound) return false;
          break;
        case 'outgoing':
          if (inbound) return false;
          break;
        case 'video':
          if (l.call_type !== 'video') return false;
          break;
      }
      if (dateFilter) {
        const t = new Date(l.started_at).getTime();
        if (t < dateFilter.dayStart || t > dateFilter.dayEnd) return false;
        if (dateFilter.fromMin !== null || dateFilter.toMin !== null) {
          const d = new Date(l.started_at);
          const mins = d.getHours() * 60 + d.getMinutes();
          if (dateFilter.fromMin !== null && mins < dateFilter.fromMin) return false;
          if (dateFilter.toMin !== null && mins > dateFilter.toMin) return false;
        }
      }
      return true;
    });
  }, [items, filter, me?.id, dateFilter]);

  // regroupe par jour
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    let lastDay = '';
    for (const l of filtered) {
      const d = dayLabel(l.started_at);
      if (d !== lastDay) {
        out.push({ kind: 'day', key: `d-${d}`, label: d });
        lastDay = d;
      }
      out.push({ kind: 'call', key: l.id, log: l });
    }
    return out;
  }, [filtered]);

  const redial = (log: CallLog) => {
    if (!log.peer) return;
    if (!available) {
      showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    // 'ended' est un état transitoire (~1.6s après un appel précédent) —
    // pas un appel en cours ; `startCall` gère déjà ce cas correctement.
    if (phase !== 'idle' && phase !== 'ended') return;
    startCall(log.peer, log.call_type).catch((e: unknown) => {
      showAlert(t('calls.startFailed'), callStartErrorMessage(e, t('calls.startFailedBody')));
    });
  };

  const removeOne = (log: CallLog) => {
    openRow.current?.close();
    // optimiste
    setItems((cur) => cur.filter((x) => x.id !== log.id));
    void callService.remove(log.id).catch(() => void load());
  };

  const clearAll = () => {
    if (items.length === 0) return;
    confirmAlert(
      t('calls.clearTitle'),
      t('calls.clearBody'),
      () => {
        setItems([]);
        void callService.clear().catch(() => void load());
      },
      { destructive: true, confirmText: t('common.delete'), cancelText: t('common.cancel') },
    );
  };

  const renderCall = (log: CallLog) => {
    const name = log.peer?.display_name || log.peer?.username || t('calls.unknown');
    const inbound = log.callee_id === me?.id;
    const missed = isMissed(log);
    const dirColor = missed ? c.danger : c.textMuted;
    const arrow = inbound
      ? missed
        ? 'phone-missed'
        : 'phone-incoming'
      : log.status === 'missed' || log.status === 'cancelled'
        ? 'phone-cancel'
        : 'phone-outgoing';

    const renderRight = (
      _progress: Animated.AnimatedInterpolation<number>,
      dragX: Animated.AnimatedInterpolation<number>,
    ) => {
      const scale = dragX.interpolate({
        inputRange: [-80, 0],
        outputRange: [1, 0.4],
        extrapolate: 'clamp',
      });
      return (
        <Pressable style={[styles.delAction, { backgroundColor: c.danger }]} onPress={() => removeOne(log)}>
          <Animated.View style={{ transform: [{ scale }], alignItems: 'center' }}>
            <Icon name="trash-can-outline" size={22} color="#fff" />
            <Text style={styles.delTxt}>{t('common.delete')}</Text>
          </Animated.View>
        </Pressable>
      );
    };

    let selfRef: Swipeable | null = null;
    return (
      <Swipeable
        ref={(r) => {
          selfRef = r;
        }}
        onSwipeableWillOpen={() => {
          if (openRow.current && openRow.current !== selfRef) openRow.current.close();
          openRow.current = selfRef;
        }}
        renderRightActions={renderRight}
        overshootRight={false}
        rightThreshold={40}
      >
        <Pressable
          style={[styles.row, { backgroundColor: c.card }]}
          android_ripple={{ color: c.surfaceAlt }}
          onPress={() => redial(log)}
          onLongPress={() =>
            confirmAlert(
              name,
              t('calls.deleteOneBody'),
              () => removeOne(log),
              { destructive: true, confirmText: t('common.delete'), cancelText: t('common.cancel') },
            )
          }
        >
          <Avatar uri={log.peer?.avatar_url} name={name} size={48} />
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
                {statusLabel(log, t)}
              </Text>
            </View>
          </View>
          <View style={styles.rowRight}>
            <Text style={[styles.rowTime, { color: c.textFaint }]}>{clockTime(log.started_at)}</Text>
            <Pressable hitSlop={10} onPress={() => redial(log)} style={styles.rowCall}>
              <Icon
                name={log.call_type === 'video' ? 'video-outline' : 'phone-outline'}
                size={22}
                color={c.primary}
              />
            </Pressable>
          </View>
        </Pressable>
      </Swipeable>
    );
  };

  const renderItem = ({ item }: { item: Row }) =>
    item.kind === 'day' ? (
      <Text style={[styles.dayLabel, { color: c.textMuted }]}>{item.label}</Text>
    ) : (
      renderCall(item.log)
    );

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
            <Pressable onPress={() => setSearchOpen(true)} hitSlop={12} style={styles.hdrBtn}>
              <Icon
                name={dateFilter ? 'calendar-search' : 'magnify'}
                size={21}
                color={dateFilter ? c.primary : c.onHeader}
              />
            </Pressable>
            <Pressable onPress={openSettings} hitSlop={12} style={styles.hdrBtn}>
              <Icon name="cog-outline" size={20} color={c.onHeader} />
            </Pressable>
            {items.length > 0 ? (
              <Pressable onPress={clearAll} hitSlop={12} style={styles.hdrBtn}>
                <Icon name="trash-can-outline" size={20} color={c.onHeader} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      <CallSearchSheet
        visible={searchOpen}
        onClose={() => setSearchOpen(false)}
        onApply={setDateFilter}
        onReset={() => setDateFilter(null)}
        hasActiveFilter={!!dateFilter}
      />

      {/* filtres */}
      <View style={styles.filterBar}>
        {FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => setFilter(f.key)}
              style={[
                styles.chip,
                { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent' },
              ]}
            >
              <Icon name={f.icon} size={13} color={on ? '#fff' : c.textMuted} />
              <Text style={[styles.chipTxt, { color: on ? '#fff' : c.textMuted }]}>
                {t(`calls.filter_${f.key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {!available ? (
        <View style={[styles.banner, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="information-outline" size={16} color={c.textMuted} />
          <Text style={[styles.bannerText, { color: c.textMuted }]}>
            {t('calls.unavailableBody')}
          </Text>
        </View>
      ) : null}

      {dateFilter ? (
        <View style={[styles.banner, { backgroundColor: c.primary + '18' }]}>
          <Icon name="calendar-search" size={16} color={c.primary} />
          <Text style={[styles.bannerText, { color: c.primary }]}>
            {new Date(dateFilter.dayStart).toLocaleDateString()}
            {dateFilter.fromMin !== null || dateFilter.toMin !== null
              ? ` · ${
                  dateFilter.fromMin !== null
                    ? `${String(Math.floor(dateFilter.fromMin / 60)).padStart(2, '0')}:${String(dateFilter.fromMin % 60).padStart(2, '0')}`
                    : '00:00'
                }–${
                  dateFilter.toMin !== null
                    ? `${String(Math.floor(dateFilter.toMin / 60)).padStart(2, '0')}:${String(dateFilter.toMin % 60).padStart(2, '0')}`
                    : '23:59'
                }`
              : ''}
          </Text>
          <Pressable onPress={() => setDateFilter(null)} hitSlop={8}>
            <Icon name="close" size={16} color={c.primary} />
          </Pressable>
        </View>
      ) : null}

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : rows.length === 0 ? (
        <View style={styles.empty}>
          <View style={[styles.iconCircle, { backgroundColor: c.surfaceAlt }]}>
            <Icon name={filter === 'all' ? 'phone-outline' : FILTERS.find((f) => f.key === filter)!.icon} size={38} color={c.textFaint} />
          </View>
          <Text style={[styles.title, { color: c.text }]}>
            {filter === 'all' ? t('calls.empty') : t('calls.filterEmpty')}
          </Text>
          {filter === 'all' ? (
            <>
              <Text style={[styles.sub, { color: c.textMuted }]}>{t('calls.emptyHint')}</Text>
              <Pressable
                onPress={newCall}
                style={[styles.cta, { backgroundColor: c.primary }]}
                android_ripple={{ color: '#ffffff30' }}
              >
                <Icon name="phone-plus" size={18} color="#fff" />
                <Text style={styles.ctaText}>{t('calls.newCall')}</Text>
              </Pressable>
            </>
          ) : (
            <Pressable onPress={() => setFilter('all')}>
              <Text style={[styles.linkTxt, { color: c.primary }]}>{t('common.seeAll')}</Text>
            </Pressable>
          )}
        </View>
      ) : (
        <FlatList
          data={rows}
          keyExtractor={(r) => r.key}
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

      <Pressable
        onPress={newCall}
        style={[
          styles.fab,
          { backgroundColor: c.primary, bottom: BAR_HEIGHT + insets.bottom +  -30  },
        ]}
        android_ripple={{ color: '#ffffff30' }}
      >
        <Icon name="phone-plus" size={24} color="#fff" />
      </Pressable>
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
      const dur = m > 0 ? `${m} min ${r}s` : `${r}s`;
      return t('calls.answeredFor', { dur });
    }
  }
}

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  hdrRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },

  filterBar: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1.5,
  },
  chipTxt: { fontSize: 12.5, fontWeight: '700' },

  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  bannerText: { fontSize: 12, flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingBottom: 12 },

  dayLabel: {
    fontSize: 12,
    fontWeight: '800',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 6,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  rowBody: { flex: 1, gap: 2 },
  rowName: { fontSize: 16, fontWeight: '600' },
  rowMeta: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rowSub: { fontSize: 13, flex: 1 },
  rowRight: { alignItems: 'flex-end', gap: 4 },
  rowTime: { fontSize: 12, fontWeight: '600' },
  rowCall: { padding: 4 },

  delAction: { justifyContent: 'center', alignItems: 'center', width: 92 },
  delTxt: { color: '#fff', fontSize: 11, fontWeight: '700', marginTop: 3 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  iconCircle: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  sub: { fontSize: 14, textAlign: 'center' },
  linkTxt: { fontSize: 14, fontWeight: '700', marginTop: 4 },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 24,
    marginTop: 12,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
