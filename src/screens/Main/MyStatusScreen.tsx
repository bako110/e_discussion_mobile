import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, confirmAlert, Icon, Screen, showAlert } from '@/components/common';
import { fontStyle, paletteBySeed } from '@/components/story/storyConfig';
import { useAuth } from '@/context/AuthContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { Story } from '@/types';
import { mediaUrl } from '@/utils/media';
import { clockTime, relativeTime } from '@/utils/time';

/** Fond d'une vignette : image de couverture OU dégradé + aperçu texte/icône. */
const Cover: React.FC<{ story: Story; name: string; radius?: number }> = ({
  story,
  name,
  radius = 14,
}) => {
  const thumb =
    story.thumbnail_url ?? (story.media_type === 'image' ? story.media_url : null);
  const [g0, g1] = paletteBySeed(name + story.id);

  if (thumb) {
    return (
      <Image
        source={{ uri: mediaUrl(thumb) }}
        style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        StyleSheet.absoluteFill,
        { backgroundColor: story.background_color ?? g0, borderRadius: radius, overflow: 'hidden' },
      ]}
    >
      {!story.background_color ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: g1, opacity: 0.45 }]} />
      ) : null}
      <View style={styles.coverCenter}>
        {story.media_type === 'text' && story.caption ? (
          <Text style={[styles.coverText, fontStyle(story.font)]} numberOfLines={4}>
            {story.caption}
          </Text>
        ) : story.media_type === 'video' ? (
          <Icon name="play-circle" size={30} color="rgba(255,255,255,0.95)" />
        ) : story.media_type === 'audio' || story.media_type === 'voice' ? (
          <Icon name="music-note" size={26} color="rgba(255,255,255,0.95)" />
        ) : (
          <Icon name="camera-outline" size={24} color="rgba(255,255,255,0.8)" />
        )}
      </View>
    </View>
  );
};

/**
 * Page « Mes statuts » — design carte + grille façon WhatsApp.
 *
 *  - En-tête : grand aperçu du dernier statut, total de vues, accès au lecteur.
 *  - Grille 2 colonnes : une vignette par statut actif, métriques en overlay,
 *    appui = spectateurs, corbeille / appui long = suppression (avec alerte).
 */
export const MyStatusScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const { mine, loading, reload } = useStories();
  const navigation = useNavigation<MainNav>();
  const c = theme.colors;
  const myName = me?.display_name || me?.username || t('stories.myStatus');

  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const openComposer = () => navigation.navigate('StoryComposer');
  const openViewer = () => navigation.navigate('StoryViewer', { authorId: me!.id });
  const openViewers = (storyId: string) =>
    navigation.navigate('StoryViewers', { storyId });

  const confirmDelete = (story: Story) => {
    // story locale pas encore confirmée (en attente / échouée) : rien côté
    // serveur à supprimer, on retire juste le brouillon local + son entrée
    // d'outbox si elle existe encore.
    if (story.pending || story.failed) {
      confirmAlert(
        t('stories.deleteTitle'),
        story.failed ? t('stories.deleteFailedConfirm') : t('stories.deleteConfirm'),
        () => {
          if (story.client_id) storyService.removePendingLocal(story.client_id);
          void reload();
        },
        { destructive: true, confirmText: t('common.delete'), cancelText: t('common.cancel') },
      );
      return;
    }
    confirmAlert(
      t('stories.deleteTitle'),
      t('stories.deleteConfirm'),
      async () => {
        try {
          await storyService.remove(story.id);
          await reload();
        } catch {
          showAlert(t('errors.generic'));
        }
      },
      {
        destructive: true,
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
      },
    );
  };

  const totalViews = mine.reduce((n, s) => n + s.view_count, 0);
  const totalReactions = mine.reduce((n, s) => n + s.reaction_count, 0);
  const latest = mine[0];

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('stories.myUpdates')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.text} />
          </Pressable>
        }
        right={
          <Pressable onPress={openComposer} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="plus-circle-outline" size={24} color={c.text} />
          </Pressable>
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
          {mine.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="circle-outline" size={34} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>{t('stories.noneMine')}</Text>
              <Text style={[styles.emptyHint, { color: c.textMuted }]}>
                {t('stories.noneMineHint')}
              </Text>
              <Pressable
                onPress={openComposer}
                style={[styles.cta, { backgroundColor: c.primary }]}
                android_ripple={{ color: '#ffffff30' }}
              >
                <Icon name="plus" size={18} color="#fff" />
                <Text style={styles.ctaText}>{t('stories.newStatus')}</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* ── Grande carte : aperçu du dernier statut + stats ─────── */}
              {latest ? (
                <Pressable
                  style={styles.hero}
                  onPress={openViewer}
                  android_ripple={{ color: c.surfaceAlt }}
                >
                  <View style={styles.heroMedia}>
                    <Cover story={latest} name={myName} radius={18} />
                    <View style={styles.heroShade} />
                    <View style={styles.heroTop}>
                      <View style={[styles.heroPill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
                        <Icon name="clock-outline" size={13} color="#fff" />
                        <Text style={styles.heroPillTxt}>
                          {relativeTime(latest.created_at)}
                        </Text>
                      </View>
                      <View style={[styles.heroPill, { backgroundColor: 'rgba(0,0,0,0.35)' }]}>
                        <Text style={styles.heroPillTxt}>
                          {t('stories.count', { count: mine.length })}
                        </Text>
                      </View>
                    </View>
                    <View style={styles.heroBottom}>
                      <Text style={styles.heroCaption} numberOfLines={1}>
                        {latest.caption?.trim() ||
                          t(`stories.mediaLabel_${latest.media_type}`)}
                      </Text>
                      <View style={styles.heroStats}>
                        <View style={styles.heroStat}>
                          <Icon name="eye" size={15} color="#fff" />
                          <Text style={styles.heroStatTxt}>{totalViews}</Text>
                        </View>
                        {totalReactions > 0 ? (
                          <View style={styles.heroStat}>
                            <Icon name="heart" size={14} color="#fff" />
                            <Text style={styles.heroStatTxt}>{totalReactions}</Text>
                          </View>
                        ) : null}
                        <View style={{ flex: 1 }} />
                        <Text style={styles.heroLink}>{t('stories.seeViewers')}</Text>
                        <Icon name="chevron-right" size={18} color="#fff" />
                      </View>
                    </View>
                  </View>
                </Pressable>
              ) : null}

              <Text style={[styles.section, { color: c.textMuted }]}>
                {t('stories.updates')}
              </Text>

              {/* ── Grille 2 colonnes ──────────────────────────────────── */}
              <View style={styles.grid}>
                {mine.map((story) => (
                  <Pressable
                    key={story.client_id ?? story.id}
                    style={styles.tile}
                    android_ripple={{ color: c.surfaceAlt }}
                    onPress={() => {
                      if (story.failed) return confirmDelete(story);
                      if (story.pending) return; // rien à voir tant que non publiée
                      openViewers(story.id);
                    }}
                    onLongPress={() => confirmDelete(story)}
                  >
                    <Cover story={story} name={myName} />
                    <View style={styles.tileShade} />

                    <Pressable
                      onPress={() => confirmDelete(story)}
                      hitSlop={8}
                      style={styles.tileDelete}
                    >
                      <Icon name="delete-outline" size={16} color="#fff" />
                    </Pressable>

                    {story.pending ? (
                      <View style={styles.tilePendingOverlay}>
                        <ActivityIndicator color="#fff" size="small" />
                        <Text style={styles.tilePendingTxt}>{t('stories.sending')}</Text>
                      </View>
                    ) : story.failed ? (
                      <View style={[styles.tilePendingOverlay, styles.tileFailedOverlay]}>
                        <Icon name="alert-circle-outline" size={20} color="#fff" />
                        <Text style={styles.tilePendingTxt}>{t('stories.sendFailed')}</Text>
                      </View>
                    ) : (
                      <View style={styles.tileBottom}>
                        <Text style={styles.tileTime}>{clockTime(story.created_at)}</Text>
                        <View style={styles.tileMetrics}>
                          <Icon name="eye" size={13} color="#fff" />
                          <Text style={styles.tileMetricTxt}>{story.view_count}</Text>
                          {story.reaction_count > 0 ? (
                            <View style={styles.tileReact}>
                              <Icon name="heart" size={12} color="#fff" />
                              <Text style={styles.tileMetricTxt}>{story.reaction_count}</Text>
                            </View>
                          ) : null}
                        </View>
                      </View>
                    )}

                    {story.edited_at ? (
                      <View style={styles.tileEdited}>
                        <Text style={styles.tileEditedTxt}>{t('stories.edited')}</Text>
                      </View>
                    ) : null}
                  </Pressable>
                ))}

                {/* Tuile « ajouter » */}
                <Pressable
                  style={[styles.tile, styles.tileAdd, { borderColor: c.border }]}
                  onPress={openComposer}
                  android_ripple={{ color: c.surfaceAlt }}
                >
                  <Icon name="plus" size={26} color={c.primary} />
                  <Text style={[styles.tileAddTxt, { color: c.primary }]}>
                    {t('stories.addStatus')}
                  </Text>
                </Pressable>
              </View>
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
};

const GAP = 12;
const H_PAD = 16;
// largeur d'une tuile pour une grille 2 colonnes avec marges + gouttière
const TILE_W = (Dimensions.get('window').width - H_PAD * 2 - GAP) / 2;

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 10, paddingBottom: 32 },

  // grande carte
  hero: { marginHorizontal: 16, marginTop: 6 },
  heroMedia: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderRadius: 18,
    overflow: 'hidden',
    justifyContent: 'space-between',
    backgroundColor: '#0003',
  },
  heroShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
  heroTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 10,
  },
  heroPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  heroPillTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  heroBottom: {
    padding: 12,
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.28)',
  },
  heroCaption: { color: '#fff', fontSize: 14, fontWeight: '700' },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  heroStat: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  heroStatTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
  heroLink: { color: '#fff', fontSize: 12, fontWeight: '700', marginRight: 2 },

  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 22,
    marginLeft: 18,
    marginBottom: 8,
  },

  // grille
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: H_PAD,
    gap: GAP,
  },
  tile: {
    width: TILE_W,
    aspectRatio: 3 / 4,
    borderRadius: 14,
    overflow: 'hidden',
    justifyContent: 'flex-end',
    backgroundColor: '#0003',
  },
  tileShade: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.10)',
  },
  coverCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 10 },
  coverText: { color: '#fff', fontSize: 11, fontWeight: '700', textAlign: 'center' },
  tileDelete: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(0,0,0,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBottom: {
    padding: 8,
    gap: 2,
    backgroundColor: 'rgba(0,0,0,0.30)',
  },
  tileTime: { color: '#fff', fontSize: 11, fontWeight: '600' },
  tileMetrics: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  tileReact: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 6 },
  tileMetricTxt: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
  tileEdited: {
    position: 'absolute',
    top: 6,
    left: 6,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  tileEditedTxt: { color: '#fff', fontSize: 9.5, fontWeight: '700', fontStyle: 'italic' },
  tilePendingOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  tileFailedOverlay: { backgroundColor: 'rgba(120,0,0,0.45)' },
  tilePendingTxt: { color: '#fff', fontSize: 11, fontWeight: '700' },
  tileAdd: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    backgroundColor: 'transparent',
  },
  tileAddTxt: { fontSize: 12, fontWeight: '700' },

  empty: { alignItems: 'center', gap: 10, paddingVertical: 60, paddingHorizontal: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 18,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
