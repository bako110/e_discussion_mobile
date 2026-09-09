import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useGroups } from '@/context/GroupsContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import type { Group, Story, StoryFeedItem } from '@/types';
import { relativeTime } from '@/utils/time';

/** Libellé « activité » selon le type du dernier média publié. */
function activityLabel(
  s: Story | undefined,
  t: (k: string) => string,
): { icon: string; label: string } {
  switch (s?.media_type) {
    case 'image':
      return { icon: 'camera-outline', label: t('stories.activityPhoto') };
    case 'video':
      return { icon: 'video-outline', label: t('stories.activityVideo') };
    case 'audio':
    case 'voice':
      return { icon: 'music-note', label: t('stories.activityAudio') };
    default:
      return { icon: 'format-text', label: t('stories.activityText') };
  }
}

export const StatusScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const { feed, mine, loading, myViews, reload } = useStories();
  const {
    groups,
    channels,
    groupsUnread,
    channelsUnread,
    reload: reloadGroups,
  } = useGroups();
  const navigation = useNavigation<MainNav>();
  const c = theme.colors;
  const myName = me?.display_name || me?.username || t('stories.myStatus');

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      void reload();
      void reloadGroups();
    }, [reload, reloadGroups]),
  );

  const openComposer = () => navigation.navigate('StoryComposer');
  const openViewer = (authorId: string) => navigation.navigate('StoryViewer', { authorId });
  const openMyStatus = () => navigation.navigate('MyStatus');
  const openScanner = () => navigation.navigate('Scanner');
  const openGroups = (kind: 'group' | 'channel') =>
    navigation.navigate('GroupsList', { kind });
  const openGroupChat = (g: Group) =>
    navigation.navigate('GroupChat', { groupId: g.id, name: g.name });
  const newGroup = (kind: 'group' | 'channel') =>
    navigation.navigate('CreateGroup', { kind });

  // groupes + chaînes fusionnés pour la liste courte « populaires », plus récents d'abord
  const popularGroups = useMemo(
    () =>
      [...groups, ...channels]
        .sort(
          (a, b) =>
            +new Date(b.last_message_at ?? b.created_at) -
            +new Date(a.last_message_at ?? a.created_at),
        )
        .slice(0, 4),
    [groups, channels],
  );

  const myLatest = mine[0];

  const filteredFeed = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return feed;
    return feed.filter((f) => {
      const n = (f.author.display_name || f.author.username || '').toLowerCase();
      return n.includes(q);
    });
  }, [feed, query]);

  // Barre horizontale : non-vus d'abord, puis vus (ordre déjà donné par le service).
  const moments = filteredFeed;

  // Activité récente : à plat, plus récent d'abord, limité.
  const activity = useMemo(
    () =>
      [...filteredFeed]
        .sort((a, b) => +new Date(b.latest_at) - +new Date(a.latest_at))
        .slice(0, 6),
    [filteredFeed],
  );

  /** Bulle ronde façon WhatsApp : avatar cerclé (anneau plein = story non vue,
   * gris = vue) + prénom + heure de la dernière story. */
  const renderMomentBubble = (item: StoryFeedItem) => {
    const name = item.author.display_name || item.author.username || '—';
    const first = name.split(' ')[0] ?? name;
    return (
      <Pressable
        key={item.author.id}
        style={styles.bubble}
        android_ripple={{ color: c.surfaceAlt, borderless: true }}
        onPress={() => openViewer(item.author.id)}
      >
        <View
          style={[
            styles.ring,
            {
              borderColor: item.has_unseen ? c.primary : c.border,
              borderStyle: item.has_unseen ? 'solid' : 'dashed',
            },
          ]}
        >
          <Avatar uri={item.author.avatar_url} name={name} size={58} online={item.author.is_online} />
          {item.stories.length > 1 ? (
            <View style={[styles.storyCount, { backgroundColor: c.primary, borderColor: c.background }]}>
              <Text style={styles.storyCountText}>{item.stories.length}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.bubbleName, { color: c.text }]} numberOfLines={1}>
          {first}
        </Text>
        <Text style={[styles.bubbleTime, { color: c.textMuted }]} numberOfLines={1}>
          {relativeTime(item.latest_at)}
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('tabs.status')}
        left={
          <Pressable
            onPress={() => navigation.navigate('Tabs', { screen: 'ChatsTab' })}
            hitSlop={12}
            style={styles.hdrBtn}
          >
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          <View style={styles.hdrActions}>
            <Pressable onPress={openScanner} hitSlop={10} style={styles.hdrBtn}>
              <Icon name="qrcode-scan" size={21} color={c.onHeader} />
            </Pressable>
            <Pressable onPress={openComposer} hitSlop={10} style={styles.hdrBtn}>
              <Icon name="plus-circle-outline" size={23} color={c.onHeader} />
            </Pressable>
          </View>
        }
        bottom={
          <View style={[styles.searchBox, { backgroundColor: c.background }]}>
            <Icon name="magnify" size={19} color={c.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder={t('stories.searchPlaceholder')}
              placeholderTextColor={c.textFaint}
              style={[styles.searchInput, { color: c.text }]}
            />
            {query.length > 0 ? (
              <Pressable onPress={() => setQuery('')} hitSlop={8}>
                <Icon name="close-circle" size={16} color={c.textFaint} />
              </Pressable>
            ) : null}
          </View>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
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
        >
          {/* ── MOMENTS ──────────────────────────────────────────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionTitleRow}>
              <Icon name="record-circle-outline" size={19} color={c.primary} />
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {t('stories.momentsTitle')}
              </Text>
            </View>
            {mine.length > 0 ? (
              <Pressable onPress={openMyStatus} hitSlop={8} style={styles.seeAll}>
                <Text style={[styles.seeAllText, { color: c.primary }]}>
                  {t('common.seeAll')}
                </Text>
                <Icon name="chevron-right" size={16} color={c.primary} />
              </Pressable>
            ) : null}
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.hList}
          >
            {/* Mon moment : bulle ronde. Tap -> voir ma story (ou composer si
                aucune). Le badge « + » ouvre le composer. Appui long -> « Mes statuts ». */}
            <Pressable
              style={styles.bubble}
              android_ripple={{ color: c.surfaceAlt, borderless: true }}
              onPress={() => (myLatest ? openViewer(me!.id) : openComposer())}
              onLongPress={() => (mine.length > 0 ? openMyStatus() : undefined)}
            >
              <View
                style={[
                  styles.ring,
                  { borderColor: myLatest ? c.primary : 'transparent' },
                ]}
              >
                <Avatar uri={me?.avatar_url} name={myName} size={58} />
                <Pressable
                  onPress={openComposer}
                  hitSlop={8}
                  style={[styles.myAddDot, { backgroundColor: c.primary, borderColor: c.background }]}
                >
                  <Icon name="plus" size={13} color="#fff" />
                </Pressable>
              </View>
              <Text style={[styles.bubbleName, { color: c.text }]} numberOfLines={1}>
                {t('stories.myMoment')}
              </Text>
              <Text style={[styles.bubbleTime, { color: c.textMuted }]} numberOfLines={1}>
                {myLatest
                  ? t('stories.viewsCount', { count: myViews })
                  : t('stories.tapToAdd')}
              </Text>
            </Pressable>

            {moments.map(renderMomentBubble)}

            {moments.length === 0 && !myLatest ? (
              <View style={styles.momentsEmptyInline}>
                <Text style={[styles.momentEmptyText, { color: c.textMuted }]}>
                  {t('stories.noContactsMoments')}
                </Text>
              </View>
            ) : null}
          </ScrollView>

          {/* ── GROUPES & CHAÎNES ────────────────────────────────────── */}
          <View style={styles.sectionHead}>
            <View style={styles.sectionTitleRow}>
              <Icon name="account-multiple-outline" size={19} color={c.primary} />
              <Text style={[styles.sectionTitle, { color: c.text }]}>
                {t('stories.groupsTitle')}
              </Text>
            </View>
            <Pressable
              onPress={() => newGroup('group')}
              hitSlop={8}
              style={styles.seeAll}
            >
              <Icon name="plus" size={16} color={c.primary} />
              <Text style={[styles.seeAllText, { color: c.primary }]}>
                {t('groups.new')}
              </Text>
            </Pressable>
          </View>

          <View style={styles.twoCards}>
            <Pressable
              style={[styles.bigCard, { backgroundColor: c.surfaceAlt }]}
              onPress={() => openGroups('group')}
              onLongPress={() => newGroup('group')}
              android_ripple={{ color: c.surface }}
            >
              <View style={[styles.bigCardIcon, { backgroundColor: c.primary }]}>
                <Icon name="account-multiple" size={22} color="#fff" />
                {groupsUnread > 0 ? (
                  <View style={[styles.bigCardBadge, { borderColor: c.surfaceAlt }]}>
                    <Text style={styles.bigCardBadgeText}>
                      {groupsUnread > 99 ? '99+' : groupsUnread}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.bigCardBody}>
                <Text style={[styles.bigCardTitle, { color: c.text }]}>
                  {t('stories.groups')}
                </Text>
                <Text style={[styles.bigCardSub, { color: c.textMuted }]}>
                  {t('stories.groupsCount', { count: groups.length })}
                </Text>
              </View>
              <View style={styles.bigCardLink}>
                <Text style={[styles.bigCardLinkText, { color: c.primary }]}>
                  {t('common.seeAll')}
                </Text>
                <Icon name="arrow-right" size={14} color={c.primary} />
              </View>
            </Pressable>

            <Pressable
              style={[styles.bigCard, { backgroundColor: c.surfaceAlt }]}
              onPress={() => openGroups('channel')}
              onLongPress={() => newGroup('channel')}
              android_ripple={{ color: c.surface }}
            >
              <View style={[styles.bigCardIcon, { backgroundColor: '#7B61FF' }]}>
                <Icon name="bullhorn" size={20} color="#fff" />
                {channelsUnread > 0 ? (
                  <View style={[styles.bigCardBadge, { borderColor: c.surfaceAlt }]}>
                    <Text style={styles.bigCardBadgeText}>
                      {channelsUnread > 99 ? '99+' : channelsUnread}
                    </Text>
                  </View>
                ) : null}
              </View>
              <View style={styles.bigCardBody}>
                <Text style={[styles.bigCardTitle, { color: c.text }]}>
                  {t('stories.channels')}
                </Text>
                <Text style={[styles.bigCardSub, { color: c.textMuted }]}>
                  {t('stories.channelsCount', { count: channels.length })}
                </Text>
              </View>
              <View style={styles.bigCardLink}>
                <Text style={[styles.bigCardLinkText, { color: '#7B61FF' }]}>
                  {t('common.seeAll')}
                </Text>
                <Icon name="arrow-right" size={14} color="#7B61FF" />
              </View>
            </Pressable>
          </View>

          {popularGroups.length > 0
            ? popularGroups.map((g, i) => (
                <Pressable
                  key={g.id}
                  onPress={() => openGroupChat(g)}
                  android_ripple={{ color: c.surfaceAlt }}
                  style={[
                    styles.groupRow,
                    i < popularGroups.length - 1 && {
                      borderBottomColor: c.divider,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Avatar uri={g.avatar_url} name={g.name} size={46} />
                  <View style={styles.groupBody}>
                    <Text style={[styles.groupName, { color: c.text }]} numberOfLines={1}>
                      {g.name}
                      {g.kind === 'channel' ? '  📢' : ''}
                    </Text>
                    <Text style={[styles.groupLast, { color: c.textMuted }]} numberOfLines={1}>
                      {g.last_message_preview ??
                        (g.kind === 'channel'
                          ? t('groups.subscribersCount', { count: g.member_count })
                          : t('groups.membersCount', { count: g.member_count }))}
                    </Text>
                  </View>
                  <View style={styles.groupMeta}>
                    <Text style={[styles.groupTime, { color: c.textFaint }]}>
                      {relativeTime(g.last_message_at)}
                    </Text>
                    {g.unread_count > 0 ? (
                      <View style={[styles.groupBadge, { backgroundColor: c.primary }]}>
                        <Text style={styles.groupBadgeText}>
                          {g.unread_count > 99 ? '99+' : g.unread_count}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              ))
            : (
              <Pressable
                onPress={() => newGroup('group')}
                style={styles.groupsEmpty}
                android_ripple={{ color: c.surfaceAlt }}
              >
                <Icon name="account-multiple-plus-outline" size={20} color={c.primary} />
                <Text style={[styles.groupsEmptyText, { color: c.primary }]}>
                  {t('groups.createFirst')}
                </Text>
              </Pressable>
            )}

          {/* ── ACTIVITÉ RÉCENTE ────────────────────────────────────── */}
          {activity.length > 0 ? (
            <>
              <View style={styles.sectionHead}>
                <View style={styles.sectionTitleRow}>
                  <Icon name="clock-outline" size={19} color={c.primary} />
                  <Text style={[styles.sectionTitle, { color: c.text }]}>
                    {t('stories.recentActivity')}
                  </Text>
                </View>
              </View>

              {activity.map((item, i) => {
                const name = item.author.display_name || item.author.username || '—';
                const { icon, label } = activityLabel(item.stories[0], t);
                return (
                  <Pressable
                    key={item.author.id}
                    onPress={() => openViewer(item.author.id)}
                    android_ripple={{ color: c.surfaceAlt }}
                    style={[
                      styles.actRow,
                      i < activity.length - 1 && {
                        borderBottomColor: c.divider,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={[styles.actRing, { borderColor: item.has_unseen ? c.primary : c.border }]}>
                      <Avatar uri={item.author.avatar_url} name={name} size={40} />
                    </View>
                    <View style={styles.actBody}>
                      <Text style={[styles.actName, { color: c.text }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <View style={styles.actSubRow}>
                        <Icon name={icon} size={13} color={c.textFaint} />
                        <Text style={[styles.actSub, { color: c.textMuted }]} numberOfLines={1}>
                          {label}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.actTime, { color: c.textFaint }]}>
                      {relativeTime(item.latest_at)}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          ) : null}

          {/* Vide global (aucune story, aucun contact) */}
          {feed.length === 0 && !myLatest ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="circle-outline" size={34} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>{t('stories.none')}</Text>
              <Text style={[styles.emptyHint, { color: c.textMuted }]}>{t('stories.emptyHint')}</Text>
            </View>
          ) : null}

          {/* CTA bas */}
          <Pressable
            onPress={openComposer}
            style={[styles.cta, { backgroundColor: c.primary }]}
            android_ripple={{ color: '#ffffff30' }}
          >
            <Icon name="plus" size={18} color="#fff" />
            <Text style={styles.ctaText}>{t('stories.newStatus')}</Text>
          </Pressable>
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  hdrActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingBottom: 28 },

  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 42,
    borderRadius: 21,
    paddingHorizontal: 14,
    elevation: 2,
    shadowColor: '#0A1730',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 14 },

  // sections
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    marginTop: 20,
    marginBottom: 10,
  },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  seeAll: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  seeAllText: { fontSize: 13, fontWeight: '700' },

  // barre horizontale — bulles rondes façon WhatsApp
  hList: { paddingHorizontal: 14, gap: 4, paddingBottom: 4, alignItems: 'flex-start' },
  bubble: { width: 76, alignItems: 'center', paddingVertical: 4 },
  ring: {
    borderWidth: 2.5,
    borderRadius: 37,
    padding: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  myAddDot: {
    position: 'absolute',
    right: -1,
    bottom: -1,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  storyCount: {
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
  storyCountText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  bubbleName: { fontSize: 12, fontWeight: '700', marginTop: 5, maxWidth: 74 },
  bubbleTime: { fontSize: 10.5, marginTop: 1 },
  momentsEmptyInline: { justifyContent: 'center', paddingHorizontal: 20, maxWidth: 220 },
  momentEmptyText: { fontSize: 12, textAlign: 'center' },
  thumbTextWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  thumbText: { color: '#fff', fontSize: 10, fontWeight: '700', textAlign: 'center' },
  thumbIconWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // groupes & chaînes
  twoCards: { flexDirection: 'row', gap: 12, paddingHorizontal: 16 },
  bigCard: { flex: 1, borderRadius: 16, padding: 14, gap: 10 },
  bigCardIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  bigCardBadge: {
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
  bigCardBadgeText: { color: '#fff', fontSize: 10, fontWeight: '800' },
  bigCardBody: { gap: 2 },
  bigCardTitle: { fontSize: 15, fontWeight: '800' },
  bigCardSub: { fontSize: 12 },
  bigCardLink: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  bigCardLinkText: { fontSize: 12, fontWeight: '700' },

  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 11,
    marginTop: 2,
  },
  groupBody: { flex: 1 },
  groupName: { fontSize: 15, fontWeight: '700' },
  groupLast: { fontSize: 13, marginTop: 2 },
  groupMeta: { alignItems: 'flex-end', gap: 4 },
  groupTime: { fontSize: 11, fontWeight: '600' },
  groupBadge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  groupBadgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  groupsEmpty: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 12,
    marginTop: 4,
  },
  groupsEmptyText: { fontSize: 13, fontWeight: '700' },

  // activité récente
  actRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  actRing: { borderWidth: 2, borderRadius: 24, padding: 2 },
  actBody: { flex: 1 },
  actName: { fontSize: 15, fontWeight: '700' },
  actSubRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  actSub: { fontSize: 13, flexShrink: 1 },
  actTime: { fontSize: 12, fontWeight: '600' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 44, paddingHorizontal: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginTop: 24,
    paddingVertical: 13,
    borderRadius: 24,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
