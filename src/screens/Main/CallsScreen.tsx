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
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showAlert } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { callService } from '@/services';
import type { CallLog } from '@/types';
import { clockTime, dayLabel } from '@/utils/time';

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
  const c = theme.colors;

  const [items, setItems] = useState<CallLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const openRow = useRef<Swipeable | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await callService.history(1, 100));
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
  const openSettings = () => navigation.navigate('CallsSettings');

  const isMissed = (l: CallLog) =>
    l.status === 'missed' || l.status === 'rejected' || l.status === 'cancelled';

  const filtered = useMemo(() => {
    return items.filter((l) => {
      const inbound = l.callee_id === me?.id;
      switch (filter) {
        case 'missed':
          return isMissed(l) && inbound;
        case 'incoming':
          return inbound;
        case 'outgoing':
          return !inbound;
        case 'video':
          return l.call_type === 'video';
        default:
          return true;
      }
    });
  }, [items, filter, me?.id]);

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
    if (phase !== 'idle') return;
    startCall(log.peer, log.call_type).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : t('calls.startFailed');
      showAlert(t('calls.startFailed'), msg);
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
            <Pressable onPress={openSettings} hitSlop={12} style={styles.hdrBtn}>
              <Icon name="cog-outline" size={20} color={c.onHeader} />
            </Pressable>
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
