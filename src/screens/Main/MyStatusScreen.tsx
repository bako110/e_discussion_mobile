import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
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

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { fontStyle, paletteBySeed } from '@/components/story/storyConfig';
import { useAuth } from '@/context/AuthContext';
import { useStories } from '@/context/StoriesContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { Story } from '@/types';
import { mediaUrl } from '@/utils/media';
import { clockTime, relativeTime } from '@/utils/time';

/** Vignette rectangulaire 48x64 — miniature média ou fond coloré + aperçu texte. */
const Preview: React.FC<{ story: Story; name: string }> = ({ story, name }) => {
  const thumb =
    story.thumbnail_url ?? (story.media_type === 'image' ? story.media_url : null);
  const [g0, g1] = paletteBySeed(name + story.id);

  if (thumb) {
    return <Image source={{ uri: mediaUrl(thumb) }} style={styles.previewImg} />;
  }
  return (
    <View style={[styles.previewBox, { backgroundColor: story.background_color ?? g0 }]}>
      {!story.background_color ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: g1, opacity: 0.4, borderRadius: 8 }]} />
      ) : null}
      {story.media_type === 'text' && story.caption ? (
        <Text style={[styles.previewText, fontStyle(story.font)]} numberOfLines={3}>
          {story.caption}
        </Text>
      ) : story.media_type === 'video' ? (
        <Icon name="play-circle" size={20} color="rgba(255,255,255,0.9)" />
      ) : story.media_type === 'audio' || story.media_type === 'voice' ? (
        <Icon name="music-note" size={18} color="rgba(255,255,255,0.9)" />
      ) : (
        <Icon name="camera-outline" size={18} color="rgba(255,255,255,0.7)" />
      )}
    </View>
  );
};

/**
 * Page « Mes statuts » — façon WhatsApp.
 *
 * Liste chacune de mes stories actives avec sa miniature, son heure de
 * publication, son nombre de vues et de réactions. Un appui ouvre la liste des
 * spectateurs ; un appui long propose la suppression. Le bouton « + » du header
 * ouvre le composer. Se rafraîchit sur les events WS `story.*`.
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
    showAlert(t('stories.deleteTitle'), t('stories.deleteConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          try {
            await storyService.remove(story.id);
            await reload();
          } catch {
            showAlert(t('errors.generic'));
          }
        },
      },
    ]);
  };

  const totalViews = mine.reduce((n, s) => n + s.view_count, 0);

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
              {/* Récapitulatif */}
              <Pressable
                style={[styles.summary, { backgroundColor: c.surfaceAlt }]}
                onPress={openViewer}
                android_ripple={{ color: c.surface }}
              >
                <Icon name="eye-outline" size={20} color={c.primary} />
                <Text style={[styles.summaryText, { color: c.text }]}>
                  {t('stories.viewsTotal', { count: totalViews })} ·{' '}
                  {t('stories.count', { count: mine.length })}
                </Text>
                <Icon name="chevron-right" size={20} color={c.textMuted} />
              </Pressable>

              <Text style={[styles.section, { color: c.textMuted }]}>
                {t('stories.updates')}
              </Text>

              {mine.map((story) => (
                <Pressable
                  key={story.id}
                  style={styles.row}
                  android_ripple={{ color: c.surfaceAlt }}
                  onPress={() => openViewers(story.id)}
                  onLongPress={() => confirmDelete(story)}
                >
                  <Preview story={story} name={myName} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
                      {story.caption?.trim() || t(`stories.mediaLabel_${story.media_type}`)}
                    </Text>
                    <Text style={[styles.rowSub, { color: c.textMuted }]}>
                      {clockTime(story.created_at)} · {relativeTime(story.created_at)}
                    </Text>
                    <View style={styles.metrics}>
                      <View style={styles.metric}>
                        <Icon name="eye-outline" size={15} color={c.textMuted} />
                        <Text style={[styles.metricText, { color: c.textMuted }]}>
                          {story.view_count}
                        </Text>
                      </View>
                      {story.reaction_count > 0 ? (
                        <View style={styles.metric}>
                          <Icon name="heart-outline" size={15} color={c.textMuted} />
                          <Text style={[styles.metricText, { color: c.textMuted }]}>
                            {story.reaction_count}
                          </Text>
                        </View>
                      ) : null}
                      {story.edited_at ? (
                        <Text style={[styles.editedTag, { color: c.textFaint }]}>
                          {t('stories.edited')}
                        </Text>
                      ) : null}
                    </View>
                  </View>
                  <Pressable
                    onPress={() => confirmDelete(story)}
                    hitSlop={10}
                    style={styles.rowAction}
                  >
                    <Icon name="delete-outline" size={20} color={c.textMuted} />
                  </Pressable>
                </Pressable>
              ))}
            </>
          )}
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 8, paddingBottom: 28 },
  summary: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 16,
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 14,
  },
  summaryText: { flex: 1, fontSize: 14, fontWeight: '600' },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 20,
    marginLeft: 18,
    marginBottom: 4,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 10 },
  previewImg: { width: 48, height: 64, borderRadius: 8, resizeMode: 'cover', backgroundColor: '#0003' },
  previewBox: {
    width: 48,
    height: 64,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    padding: 4,
  },
  previewText: { color: '#fff', fontSize: 7, fontWeight: '700', textAlign: 'center' },
  rowBody: { flex: 1, gap: 2 },
  rowTitle: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 12 },
  metrics: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 3 },
  metric: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  metricText: { fontSize: 12, fontWeight: '600' },
  editedTag: { fontSize: 11, fontStyle: 'italic' },
  rowAction: { padding: 4 },
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
