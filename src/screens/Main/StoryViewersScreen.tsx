import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { useWs } from '@/context/WebSocketContext';
import type { MainNav, MainStackParamList } from '@/navigation/types';
import { storyService } from '@/services';
import type { StoryViewer } from '@/types';
import { clockTime, relativeTime } from '@/utils/time';

/**
 * Liste des personnes ayant vu une de mes stories — façon WhatsApp
 * (« Vu par »). Chaque ligne : avatar, nom, heure de visionnage, et la
 * réaction emoji éventuelle. Se met à jour en temps réel sur les events WS
 * `story.viewed` / `story.reaction`.
 */
export const StoryViewersScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { addListener } = useWs();
  const navigation = useNavigation<MainNav>();
  const route = useRoute<RouteProp<MainStackParamList, 'StoryViewers'>>();
  const { storyId } = route.params;
  const c = theme.colors;

  const [viewers, setViewers] = useState<StoryViewer[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const list = await storyService.viewers(storyId);
      setViewers(list);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [storyId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(
    () => addListener((e) => {
      if (
        (e.type === 'story.viewed' || e.type === 'story.reaction') &&
        e.story_id === storyId
      ) {
        void load();
      }
    }),
    [addListener, load, storyId],
  );

  const reactions = viewers.filter((v) => v.reaction);

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('stories.viewedBy')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.text} />
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
                await load();
                setRefreshing(false);
              }}
              tintColor={c.primary}
            />
          }
        >
          {/* Bandeau récap */}
          <View style={styles.recap}>
            <View style={styles.recapItem}>
              <Icon name="eye-outline" size={18} color={c.primary} />
              <Text style={[styles.recapText, { color: c.text }]}>
                {t('stories.viewsCount', { count: viewers.length })}
              </Text>
            </View>
            {reactions.length > 0 ? (
              <View style={styles.recapItem}>
                <Icon name="heart" size={16} color={c.primary} />
                <Text style={[styles.recapText, { color: c.text }]}>
                  {t('stories.reactionsCount', { count: reactions.length })}
                </Text>
              </View>
            ) : null}
          </View>

          {error && viewers.length === 0 ? (
            <View style={styles.empty}>
              <Text style={[styles.emptyText, { color: c.textMuted }]}>
                {t('errors.generic')}
              </Text>
            </View>
          ) : viewers.length === 0 ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="eye-off-outline" size={30} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {t('stories.noViewsYet')}
              </Text>
              <Text style={[styles.emptyHint, { color: c.textMuted }]}>
                {t('stories.noViewsYetHint')}
              </Text>
            </View>
          ) : (
            viewers.map((v) => {
              const name = v.user.display_name || v.user.username || '—';
              return (
                <View key={v.user.id} style={styles.row}>
                  <Avatar uri={v.user.avatar_url} name={name} size={44} />
                  <View style={styles.rowBody}>
                    <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[styles.time, { color: c.textMuted }]}>
                      {clockTime(v.viewed_at)} · {relativeTime(v.viewed_at)}
                    </Text>
                  </View>
                  {v.reaction ? <Text style={styles.reaction}>{v.reaction}</Text> : null}
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { paddingVertical: 6, paddingBottom: 28 },
  recap: {
    flexDirection: 'row',
    gap: 22,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  recapItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  recapText: { fontSize: 14, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 18, paddingVertical: 9 },
  rowBody: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600' },
  time: { fontSize: 12, marginTop: 2 },
  reaction: { fontSize: 22 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 56, paddingHorizontal: 40 },
  emptyIcon: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
});
