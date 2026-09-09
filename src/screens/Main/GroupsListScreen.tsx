import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav, MainScreenProps } from '@/navigation/types';
import type { Group } from '@/types';
import { relativeTime } from '@/utils/time';

/**
 * Liste « Voir tout » — soit mes groupes, soit mes chaînes selon
 * `route.params.kind`. Header + FAB de création + accès scanner.
 */
export const GroupsListScreen: React.FC<MainScreenProps<'GroupsList'>> = ({
  route,
  navigation,
}) => {
  const kind = route.params?.kind ?? 'group';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { groups, channels, loading, reload } = useGroups();
  const c = theme.colors;

  const [refreshing, setRefreshing] = useState(false);
  const data = kind === 'channel' ? channels : groups;

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const renderRow = ({ item }: { item: Group }) => (
    <Pressable
      style={styles.row}
      android_ripple={{ color: c.surfaceAlt }}
      onPress={() => navigation.navigate('GroupChat', { groupId: item.id, name: item.name })}
    >
      <Avatar uri={item.avatar_url} name={item.name} size={52} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.time, { color: item.unread_count ? c.primary : c.textFaint }]}>
            {relativeTime(item.last_message_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, { color: c.textMuted }]} numberOfLines={1}>
            {item.last_message_preview ??
              (kind === 'channel'
                ? t('groups.subscribersCount', { count: item.member_count })
                : t('groups.membersCount', { count: item.member_count }))}
          </Text>
          {item.unread_count > 0 ? (
            <View style={[styles.badge, { backgroundColor: c.primary }]}>
              <Text style={styles.badgeText}>
                {item.unread_count > 99 ? '99+' : item.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={kind === 'channel' ? t('groups.channels') : t('groups.groups')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
        right={
          <View style={styles.hdrActions}>
            <Pressable onPress={() => navigation.navigate('Scanner')} hitSlop={10} style={styles.hdrBtn}>
              <Icon name="qrcode-scan" size={21} color={c.text} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('CreateGroup', { kind })}
              hitSlop={10}
              style={styles.hdrBtn}
            >
              <Icon name="plus" size={23} color={c.text} />
            </Pressable>
          </View>
        }
      />

      {loading && data.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(g) => g.id}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
          contentContainerStyle={data.length === 0 ? styles.emptyWrap : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await reload();
                setRefreshing(false);
              }}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon
                  name={kind === 'channel' ? 'bullhorn-outline' : 'account-multiple-outline'}
                  size={34}
                  color={c.textFaint}
                />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {kind === 'channel' ? t('groups.noChannels') : t('groups.noGroups')}
              </Text>
              <Pressable
                onPress={() => navigation.navigate('CreateGroup', { kind })}
                style={[styles.cta, { backgroundColor: c.primary }]}
              >
                <Icon name="plus" size={18} color="#fff" />
                <Text style={styles.ctaText}>
                  {kind === 'channel' ? t('groups.createChannel') : t('groups.createGroup')}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  name: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  time: { fontSize: 12, fontWeight: '600' },
  preview: { fontSize: 14, flex: 1, marginRight: 8 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 80 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },

  // ── onglet Groupes ──
  tabHdrActions: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  tabListContent: { paddingBottom: 12 },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  tabSectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  clearFilter: { fontSize: 13, fontWeight: '700' },
  kindDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },

  // carrousel bulles (façon « moments »)
  hList: { paddingHorizontal: 12, gap: 2, paddingBottom: 4 },
  bubble: { width: 78, alignItems: 'center', paddingVertical: 4 },
  bubbleRing: {
    borderWidth: 2.5,
    borderRadius: 38,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleKind: {
    position: 'absolute',
    right: 0,
    bottom: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleCount: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    paddingHorizontal: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bubbleCountText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  bubbleName: { fontSize: 12, fontWeight: '700', marginTop: 5, maxWidth: 76 },
  bubbleTime: { fontSize: 10.5, marginTop: 1 },

  // cartes filtre Groupes / Chaînes
  twoCards: { flexDirection: 'row', gap: 12, paddingHorizontal: 16, marginTop: 6 },
  filterCard: { flex: 1, borderRadius: 16, padding: 14, gap: 8, borderWidth: 2 },
  filterCardIcon: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCardBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    borderWidth: 2,
    backgroundColor: '#E5484D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterCardBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  filterCardTitle: { fontSize: 15, fontWeight: '800' },
  filterCardSub: { fontSize: 12 },
});

// ─────────────────────────────────────────────────────────────────────────────
type GroupFilter = 'all' | 'group' | 'channel';

/** Bulle ronde d'un groupe / chaîne actif (carrousel haut, façon « moments »). */
const GroupBubble: React.FC<{
  group: Group;
  channel: boolean;
  newLabel: string;
  onPress: () => void;
}> = ({ group, channel, newLabel, onPress }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const accent = channel ? c.primary : c.success;
  const hasUnread = group.unread_count > 0;
  return (
    <Pressable style={styles.bubble} onPress={onPress} android_ripple={{ color: c.surfaceAlt, borderless: true }}>
      <View
        style={[
          styles.bubbleRing,
          { borderColor: hasUnread ? accent : c.border, borderStyle: hasUnread ? 'solid' : 'dashed' },
        ]}
      >
        <Avatar uri={group.avatar_url} name={group.name} size={58} />
        <View style={[styles.bubbleKind, { backgroundColor: accent, borderColor: c.background }]}>
          <Icon name={channel ? 'bullhorn' : 'account-group'} size={11} color="#fff" />
        </View>
        {hasUnread ? (
          <View style={[styles.bubbleCount, { backgroundColor: c.primary, borderColor: c.background }]}>
            <Text style={styles.bubbleCountText}>
              {group.unread_count > 99 ? '99+' : group.unread_count}
            </Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.bubbleName, { color: c.text }]} numberOfLines={1}>
        {group.name}
      </Text>
      <Text style={[styles.bubbleTime, { color: c.textFaint }]} numberOfLines={1}>
        {group.last_message_at ? relativeTime(group.last_message_at) : newLabel}
      </Text>
    </Pressable>
  );
};

/** Carte-filtre Groupes / Chaînes (2 cartes façon Statut). */
const FilterCard: React.FC<{
  selected: boolean;
  icon: string;
  tint: string;
  title: string;
  sub: string;
  badge: number;
  onPress: () => void;
}> = ({ selected, icon, tint, title, sub, badge, onPress }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <Pressable
      style={[
        styles.filterCard,
        { backgroundColor: c.surfaceAlt, borderColor: selected ? tint : 'transparent' },
      ]}
      onPress={onPress}
      android_ripple={{ color: c.surface }}
    >
      <View style={[styles.filterCardIcon, { backgroundColor: tint }]}>
        <Icon name={icon} size={20} color="#fff" />
        {badge > 0 ? (
          <View style={[styles.filterCardBadge, { borderColor: c.surfaceAlt }]}>
            <Text style={styles.filterCardBadgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
      <Text style={[styles.filterCardTitle, { color: c.text }]}>{title}</Text>
      <Text style={[styles.filterCardSub, { color: c.textMuted }]}>{sub}</Text>
    </Pressable>
  );
};

/**
 * Onglet « Groupes » de la tab bar — design façon Statut :
 *   1. carrousel horizontal des groupes/chaînes actifs (bulles rondes)
 *   2. deux cartes filtre : Mes groupes (N) · Mes chaînes (N)
 *   3. liste filtrée
 */
export const GroupsTabScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { groups, channels, groupsUnread, channelsUnread, loading, reload } = useGroups();
  const c = theme.colors;
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<GroupFilter>('all');

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const all = useMemo(
    () =>
      [...groups.map((g) => ({ g, channel: false })), ...channels.map((g) => ({ g, channel: true }))].sort(
        (a, b) => {
          const ta = a.g.last_message_at ? Date.parse(a.g.last_message_at) : 0;
          const tb = b.g.last_message_at ? Date.parse(b.g.last_message_at) : 0;
          return tb - ta;
        },
      ),
    [groups, channels],
  );

  // carrousel : ceux qui ont eu de l'activité (dernier message), non-lus d'abord
  const active = useMemo(
    () =>
      all
        .filter((x) => x.g.last_message_at || x.g.unread_count > 0)
        .sort((a, b) => b.g.unread_count - a.g.unread_count)
        .slice(0, 12),
    [all],
  );

  const list = useMemo(
    () => (filter === 'all' ? all : all.filter((x) => (filter === 'channel') === x.channel)),
    [all, filter],
  );

  const openChat = useCallback(
    (g: Group) => navigation.navigate('GroupChat', { groupId: g.id, name: g.name }),
    [navigation],
  );

  const renderRow = ({ item }: { item: { g: Group; channel: boolean } }) => {
    const g = item.g;
    return (
      <Pressable
        style={styles.row}
        android_ripple={{ color: c.surfaceAlt }}
        onPress={() => openChat(g)}
      >
        <View>
          <Avatar uri={g.avatar_url} name={g.name} size={52} />
          <View
            style={[
              styles.kindDot,
              { backgroundColor: item.channel ? c.primary : c.success, borderColor: c.card },
            ]}
          >
            <Icon name={item.channel ? 'bullhorn' : 'account-group'} size={11} color="#fff" />
          </View>
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {g.name}
            </Text>
            <Text style={[styles.time, { color: g.unread_count ? c.primary : c.textFaint }]}>
              {relativeTime(g.last_message_at)}
            </Text>
          </View>
          <View style={styles.rowBottom}>
            <Text style={[styles.preview, { color: c.textMuted }]} numberOfLines={1}>
              {g.last_message_preview ??
                (item.channel
                  ? t('groups.subscribersCount', { count: g.member_count })
                  : t('groups.membersCount', { count: g.member_count }))}
            </Text>
            {g.unread_count > 0 ? (
              <View style={[styles.badge, { backgroundColor: c.primary }]}>
                <Text style={styles.badgeText}>
                  {g.unread_count > 99 ? '99+' : g.unread_count}
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Pressable>
    );
  };

  const header = (
    <View>
      {active.length > 0 ? (
        <>
          <View style={styles.sectionHead}>
            <Text style={[styles.tabSectionTitle, { color: c.text }]}>{t('groups.active')}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
          >
            {active.map((x) => (
              <GroupBubble
                key={x.g.id}
                group={x.g}
                channel={x.channel}
                newLabel={t('groups.new')}
                onPress={() => openChat(x.g)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      <View style={styles.twoCards}>
        <FilterCard
          selected={filter === 'group' || filter === 'all'}
          icon="account-group"
          tint={c.success}
          title={t('groups.groups')}
          sub={t('groups.membersShort', { count: groups.length })}
          badge={groupsUnread}
          onPress={() => setFilter((f) => (f === 'group' ? 'all' : 'group'))}
        />
        <FilterCard
          selected={filter === 'channel' || filter === 'all'}
          icon="bullhorn"
          tint={c.primary}
          title={t('groups.channels')}
          sub={t('groups.channelsShort', { count: channels.length })}
          badge={channelsUnread}
          onPress={() => setFilter((f) => (f === 'channel' ? 'all' : 'channel'))}
        />
      </View>

      <View style={styles.sectionHead}>
        <Text style={[styles.tabSectionTitle, { color: c.text }]}>
          {filter === 'channel'
            ? t('groups.channels')
            : filter === 'group'
              ? t('groups.groups')
              : t('groups.allTitle')}
        </Text>
        {filter !== 'all' ? (
          <Pressable onPress={() => setFilter('all')} hitSlop={8}>
            <Text style={[styles.clearFilter, { color: c.primary }]}>{t('common.seeAll')}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('tabs.groups')}
        right={
          <View style={styles.tabHdrActions}>
            <Pressable onPress={() => navigation.navigate('Scanner')} hitSlop={10} style={styles.hdrBtn}>
              <Icon name="qrcode-scan" size={21} color={c.onHeader} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('CreateGroup', {})}
              hitSlop={10}
              style={styles.hdrBtn}
            >
              <Icon name="plus" size={23} color={c.onHeader} />
            </Pressable>
          </View>
        }
      />

      {loading && all.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={list}
          keyExtractor={(it) => it.g.id}
          renderItem={renderRow}
          ListHeaderComponent={header}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
          contentContainerStyle={list.length === 0 ? styles.emptyWrap : styles.tabListContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await reload();
                setRefreshing(false);
              }}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon
                  name={filter === 'channel' ? 'bullhorn-outline' : 'account-multiple-outline'}
                  size={34}
                  color={c.textFaint}
                />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {filter === 'channel' ? t('groups.noChannels') : t('groups.noGroups')}
              </Text>
              <Pressable
                onPress={() =>
                  navigation.navigate('CreateGroup', filter === 'channel' ? { kind: 'channel' } : {})
                }
                style={[styles.cta, { backgroundColor: c.primary }]}
              >
                <Icon name="plus" size={18} color="#fff" />
                <Text style={styles.ctaText}>
                  {filter === 'channel' ? t('groups.createChannel') : t('groups.createGroup')}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </Screen>
  );
};
