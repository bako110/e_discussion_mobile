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

import { AppHeader, Avatar, CachedImage, Icon, Screen, showSheet } from '@/components/common';
import { openStoryPrivacySheet } from '@/services/storyPrivacySheet';
import { useAuth } from '@/context/AuthContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import type { Story, StoryFeedItem } from '@/types';
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
  const navigation = useNavigation<MainNav>();
  const c = theme.colors;
  const myName = me?.display_name || me?.username || t('stories.myStatus');

  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openComposer = () => navigation.navigate('StoryComposer');
  const openViewer = (authorId: string) => navigation.navigate('StoryViewer', { authorId });
  const openMyStatus = () => navigation.navigate('MyStatus');
  const openScanner = () => navigation.navigate('Scanner');

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

  /** total de vues cumulées sur toutes les stories actives d'un auteur. */
  const totalViews = useCallback(
    (item: StoryFeedItem) => item.stories.reduce((n, s) => n + (s.view_count || 0), 0),
    [],
  );

  /** URL d'aperçu (image/vidéo) de la story la plus récente d'un auteur. */
  const previewUri = useCallback((item: StoryFeedItem): string | null => {
    const s = item.stories[0];
    if (!s) return null;
    return s.thumbnail_url || (s.media_type === 'image' ? s.media_url : null);
  }, []);

  // Statuts populaires : triés par vues cumulées décroissantes (façon WhatsApp
  // « les plus vus »). On ne garde que ceux qui ont au moins une vue.
  const popular = useMemo(
    () =>
      [...filteredFeed]
        .filter((f) => totalViews(f) > 0)
        .sort((a, b) => totalViews(b) - totalViews(a))
        .slice(0, 8),
    [filteredFeed, totalViews],
  );

  // Activité récente : à plat, plus récent d'abord, limité.
  const activity = useMemo(
    () =>
      [...filteredFeed]
        .sort((a, b) => +new Date(b.latest_at) - +new Date(a.latest_at))
        .slice(0, 6),
    [filteredFeed],
  );

  /** Carte verticale façon WhatsApp : aperçu de la dernière story en fond,
   * avatar cerclé (anneau vert = non vue) en haut, nom en bas. */
  const renderMomentCard = (item: StoryFeedItem) => {
    const name = item.author.display_name || item.author.username || '—';
    const first = name.split(' ')[0] ?? name;
    const uri = previewUri(item);
    const bg = item.stories[0]?.background_color || c.surfaceAlt;
    return (
      <Pressable
        key={item.author.id}
        style={styles.card}
        android_ripple={{ color: c.surfaceAlt }}
        onPress={() => openViewer(item.author.id)}
      >
        <View style={[styles.cardMedia, { backgroundColor: bg }]}>
          {uri ? (
            <CachedImage uri={uri} style={styles.cardImg} resizeMode="cover" />
          ) : (
            <View style={styles.cardTextPreview}>
              <Text style={styles.cardTextPreviewTxt} numberOfLines={4}>
                {item.stories[0]?.caption || ''}
              </Text>
            </View>
          )}
          <View style={styles.cardShade} />
          <View
            style={[
              styles.cardRing,
              { borderColor: item.has_unseen ? c.primary : 'rgba(255,255,255,0.85)' },
            ]}
          >
            <Avatar uri={item.author.avatar_url} name={name} size={34} />
          </View>
          {item.stories.length > 1 ? (
            <View style={[styles.cardCount, { backgroundColor: c.primary }]}>
              <Text style={styles.cardCountTxt}>{item.stories.length}</Text>
            </View>
          ) : null}
        </View>
        <Text style={[styles.cardName, { color: c.text }]} numberOfLines={1}>
          {first}
        </Text>
        <Text style={[styles.cardTime, { color: c.textMuted }]} numberOfLines={1}>
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
            <Pressable
              onPress={() =>
                showSheet({
                  title: t('tabs.status'),
                  actions: [
                    {
                      label: t('storyPrivacy.title'),
                      icon: 'shield-account-outline',
                      onPress: () => openStoryPrivacySheet(),
                    },
                  ],
                })
              }
              hitSlop={10}
              style={styles.hdrBtn}
            >
              <Icon name="dots-vertical" size={21} color={c.onHeader} />
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
            {/* Ma carte « statut ». Tap -> voir ma story (ou composer si aucune).
                Le badge « + » ouvre le composer. Appui long -> « Mes statuts ». */}
            <Pressable
              style={styles.card}
              android_ripple={{ color: c.surfaceAlt }}
              onPress={() => (myLatest ? openViewer(me!.id) : openComposer())}
              onLongPress={() => (mine.length > 0 ? openMyStatus() : undefined)}
            >
              <View style={[styles.cardMedia, { backgroundColor: c.surfaceAlt }]}>
                {myLatest?.thumbnail_url || myLatest?.media_url ? (
                  <CachedImage
                    uri={myLatest.thumbnail_url || myLatest.media_url}
                    style={styles.cardImg}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={styles.cardTextPreview}>
                    <Icon name="camera-plus-outline" size={26} color={c.textFaint} />
                  </View>
                )}
                <View style={styles.cardShade} />
                <View style={[styles.cardRing, { borderColor: 'rgba(255,255,255,0.85)' }]}>
                  <Avatar uri={me?.avatar_url} name={myName} size={34} />
                </View>
                <View style={[styles.cardAddDot, { backgroundColor: c.primary, borderColor: c.card }]}>
                  <Icon name="plus" size={12} color="#fff" />
                </View>
              </View>
              <Text style={[styles.cardName, { color: c.text }]} numberOfLines={1}>
                {t('stories.myMoment')}
              </Text>
              <Text style={[styles.cardTime, { color: c.textMuted }]} numberOfLines={1}>
                {myLatest
                  ? t('stories.viewsCount', { count: myViews })
                  : t('stories.tapToAdd')}
              </Text>
            </Pressable>

            {moments.map(renderMomentCard)}

            {moments.length === 0 && !myLatest ? (
              <View style={styles.momentsEmptyInline}>
                <Text style={[styles.momentEmptyText, { color: c.textMuted }]}>
                  {t('stories.noContactsMoments')}
                </Text>
              </View>
            ) : null}
          </ScrollView>

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

          {/* ── STATUTS POPULAIRES (les plus vus) ───────────────────── */}
          {popular.length > 0 ? (
            <>
              <View style={styles.sectionHead}>
                <View style={styles.sectionTitleRow}>
                  <Icon name="fire" size={19} color={c.primary} />
                  <Text style={[styles.sectionTitle, { color: c.text }]}>
                    {t('stories.popularTitle')}
                  </Text>
                </View>
              </View>
              <Text style={[styles.popularHint, { color: c.textMuted }]}>
                {t('stories.popularHint')}
              </Text>

              {popular.map((item, i) => {
                const name = item.author.display_name || item.author.username || '—';
                const views = totalViews(item);
                const { icon, label } = activityLabel(item.stories[0], t);
                return (
                  <Pressable
                    key={item.author.id}
                    onPress={() => openViewer(item.author.id)}
                    android_ripple={{ color: c.surfaceAlt }}
                    style={[
                      styles.actRow,
                      i < popular.length - 1 && {
                        borderBottomColor: c.divider,
                        borderBottomWidth: StyleSheet.hairlineWidth,
                      },
                    ]}
                  >
                    <View style={[styles.rankWrap, { backgroundColor: c.primary + '18' }]}>
                      <Text style={[styles.rankTxt, { color: c.primary }]}>{i + 1}</Text>
                    </View>
                    <View
                      style={[styles.actRing, { borderColor: item.has_unseen ? c.primary : c.border }]}
                    >
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
                    <View style={styles.viewsPill}>
                      <Icon name="eye-outline" size={14} color={c.textMuted} />
                      <Text style={[styles.viewsTxt, { color: c.textMuted }]}>
                        {views > 999 ? `${(views / 1000).toFixed(1)}k` : views}
                      </Text>
                    </View>
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

  // barre horizontale — cartes verticales avec aperçu façon WhatsApp
  hList: { paddingHorizontal: 12, gap: 10, paddingBottom: 4, alignItems: 'flex-start' },
  card: { width: 96, alignItems: 'center' },
  cardMedia: {
    width: 96,
    height: 132,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  cardImg: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  cardShade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 44,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  cardTextPreview: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 8 },
  cardTextPreviewTxt: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  cardRing: {
    position: 'absolute',
    top: 6,
    left: 6,
    borderWidth: 2.5,
    borderRadius: 22,
    padding: 2,
  },
  cardAddDot: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCount: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    paddingHorizontal: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardCountTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  cardName: { fontSize: 12, fontWeight: '700', marginTop: 6, maxWidth: 92, textAlign: 'center' },
  cardTime: { fontSize: 10.5, marginTop: 1 },
  momentsEmptyInline: { justifyContent: 'center', paddingHorizontal: 20, maxWidth: 220 },
  momentEmptyText: { fontSize: 12, textAlign: 'center' },

  // statuts populaires
  popularHint: { fontSize: 12.5, paddingHorizontal: 16, marginTop: -4, marginBottom: 8 },
  rankWrap: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  rankTxt: { fontSize: 11, fontWeight: '800' },
  viewsPill: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  viewsTxt: { fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] },

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
