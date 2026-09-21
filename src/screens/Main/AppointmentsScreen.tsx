/**
 * Liste des rendez-vous (organisés par moi ou où je suis invité), avec
 * filtres à venir / en cours / passés / annulés.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showToast } from '@/components/common';
import { onAppointmentEvent } from '@/context/AppointmentSync';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { appointmentService } from '@/services';
import type { Appointment, AppointmentFilter } from '@/types';

const FILTERS: { key: AppointmentFilter; icon: string }[] = [
  { key: 'upcoming', icon: 'calendar-clock' },
  { key: 'ongoing', icon: 'calendar-star' },
  { key: 'past', icon: 'calendar-check' },
  { key: 'cancelled', icon: 'calendar-remove' },
];

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export const AppointmentsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [filter, setFilter] = useState<AppointmentFilter>('upcoming');
  const [items, setItems] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (f: AppointmentFilter) => {
    try {
      setItems(await appointmentService.list(f));
    } catch {
      /* hors-ligne — on garde la dernière liste affichée */
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      setLoading(true);
      void load(filter);
    }, [load, filter]),
  );

  // temps réel : un RDV créé/mis à jour par un autre participant (accept,
  // decline, annulation) recharge la liste immédiatement, sans attendre le
  // prochain focus d'écran.
  useEffect(() => onAppointmentEvent(() => void load(filter)), [load, filter]);

  const onSelectFilter = (f: AppointmentFilter) => {
    setFilter(f);
    setLoading(true);
    void load(f);
  };

  /** Appui long : retire ce RDV de MA liste uniquement (l'organisateur et
   * les autres participants continuent de le voir normalement). */
  const onLongPressItem = (a: Appointment) => {
    confirmAlert(
      t('appointments.hideConfirmTitle'),
      t('appointments.hideConfirmBody'),
      () => {
        void appointmentService
          .hide(a.id)
          .then(() => {
            setItems((prev) => prev.filter((it) => it.id !== a.id));
            showToast(t('appointments.hidden'));
          })
          .catch(() => showToast(t('errors.generic'), { type: 'error' }));
      },
      { confirmText: t('appointments.hideConfirm'), destructive: true },
    );
  };

  const statusOf = (a: Appointment): { label: string; color: string } => {
    if (a.status === 'cancelled') return { label: t('appointments.statusCancelled'), color: c.danger };
    if (a.my_status === 'organizer') return { label: t('appointments.statusOrganizer'), color: c.primary };
    if (a.my_status === 'accepted') return { label: t('appointments.statusAccepted'), color: c.success };
    if (a.my_status === 'declined') return { label: t('appointments.statusDeclined'), color: c.danger };
    return { label: t('appointments.statusPending'), color: c.textMuted };
  };

  const renderItem = ({ item }: { item: Appointment }) => {
    const st = statusOf(item);
    const others = item.participants.filter((p) => p.user_id !== item.organizer_id);
    return (
      <Pressable
        onPress={() => navigation.navigate('AppointmentDetail', { appointmentId: item.id })}
        onLongPress={() => onLongPressItem(item)}
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}
      >
        <View style={styles.cardTop}>
          <Text style={[styles.title, { color: c.text }]} numberOfLines={1}>
            {item.title}
          </Text>
          <View style={[styles.badge, { backgroundColor: st.color + '18' }]}>
            <Text style={[styles.badgeTxt, { color: st.color }]}>{st.label}</Text>
          </View>
        </View>
        <View style={styles.row}>
          <Icon name="clock-outline" size={14} color={c.textFaint} />
          <Text style={[styles.meta, { color: c.textMuted }]}>{formatWhen(item.scheduled_at)}</Text>
        </View>
        {item.location ? (
          <View style={styles.row}>
            <Icon name="map-marker-outline" size={14} color={c.textFaint} />
            <Text style={[styles.meta, { color: c.textMuted }]} numberOfLines={1}>
              {item.location}
            </Text>
          </View>
        ) : null}
        <View style={styles.avatars}>
          <Avatar uri={item.organizer.avatar_url} name={item.organizer.display_name} size={26} />
          {others.slice(0, 4).map((p) => (
            <View key={p.id} style={styles.avatarOverlap}>
              <Avatar uri={p.user.avatar_url} name={p.user.display_name} size={26} />
            </View>
          ))}
          {others.length > 4 ? (
            <View style={[styles.moreBubble, { backgroundColor: c.surfaceAlt }]}>
              <Text style={[styles.moreTxt, { color: c.textMuted }]}>+{others.length - 4}</Text>
            </View>
          ) : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('appointments.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          <Pressable
            onPress={() => navigation.navigate('CreateAppointment')}
            hitSlop={12}
            style={styles.hdrBtn}
          >
            <Icon name="plus" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <View style={styles.filterRow}>
        {FILTERS.map((f) => {
          const active = filter === f.key;
          return (
            <Pressable
              key={f.key}
              onPress={() => onSelectFilter(f.key)}
              style={[
                styles.chip,
                {
                  backgroundColor: active ? c.primary : c.surfaceAlt,
                  borderColor: active ? c.primary : c.border,
                },
              ]}
            >
              <Icon name={f.icon} size={14} color={active ? '#fff' : c.textMuted} />
              <Text style={[styles.chipTxt, { color: active ? '#fff' : c.textMuted }]}>
                {t(`appointments.filter_${f.key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          renderItem={renderItem}
          contentContainerStyle={items.length === 0 ? styles.emptyWrap : styles.listContent}
          refreshing={refreshing}
          onRefresh={() => {
            setRefreshing(true);
            void load(filter);
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Icon name="calendar-blank-outline" size={40} color={c.textFaint} />
              <Text style={[styles.emptyTxt, { color: c.textMuted }]}>
                {t('appointments.empty')}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  filterRow: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, paddingVertical: 10 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  chipTxt: { fontSize: 12, fontWeight: '700', lineHeight: 18 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { padding: 16, gap: 10 },
  emptyWrap: { flexGrow: 1 },
  card: { borderRadius: 14, borderWidth: 1, padding: 14, marginBottom: 10, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { fontSize: 15.5, fontWeight: '700', flex: 1 },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  badgeTxt: { fontSize: 11, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  meta: { fontSize: 12.5 },
  avatars: { flexDirection: 'row', alignItems: 'center' },
  avatarOverlap: { marginLeft: -8, borderWidth: 2, borderColor: 'transparent' },
  moreBubble: {
    marginLeft: -8,
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreTxt: { fontSize: 10.5, fontWeight: '700' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 80 },
  emptyTxt: { fontSize: 14 },
});
