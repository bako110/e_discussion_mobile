/**
 * Page dédiée « Médias » d'une conversation — façon WhatsApp : grille complète
 * photos/vidéos, ouverte directement depuis le menu ⋮ du chat (PAS depuis le
 * profil du contact, qui n'a plus aucune section médias/fichiers). Les
 * fichiers (documents) ont leur PROPRE entrée directe dans ce même menu
 * (`SharedFilesScreen`) — jamais imbriquée ici, pour un accès en un seul tap.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { conversationService } from '@/services';
import type { SharedMedia } from '@/types';
import { mediaUrl } from '@/utils/media';

const NUM_COLUMNS = 3;
// Le serveur plafonne `limit` à 100 (Pagination, voir app/api/deps.py côté
// backend) — une valeur au-delà est REJETÉE (422), pas juste tronquée : d'où
// l'écran vide silencieux avant ce fix (l'erreur réseau était avalée par le
// catch). Pagination réelle (`onEndReached`) plutôt qu'une grosse page unique
// pour rester valide même avec beaucoup de médias.
const PAGE_LIMIT = 60;

export const SharedMediaScreen: React.FC<MainScreenProps<'SharedMedia'>> = ({ route, navigation }) => {
  const { conversationId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [media, setMedia] = useState<SharedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);

  const load = useCallback(async () => {
    try {
      const first = await conversationService.media(conversationId, 1, PAGE_LIMIT);
      setMedia(first.filter((m) => m.type === 'image' || m.type === 'video'));
      setPage(1);
      setHasMore(first.length >= PAGE_LIMIT);
    } catch {
      /* hors-ligne — page vide */
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    try {
      const next = page + 1;
      const raw = await conversationService.media(conversationId, next, PAGE_LIMIT);
      setPage(next);
      setHasMore(raw.length >= PAGE_LIMIT);
      setMedia((cur) => [...cur, ...raw.filter((m) => m.type === 'image' || m.type === 'video')]);
    } catch {
      /* échec réseau : on retentera au prochain onEndReached */
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, page, hasMore, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('chat.sharedMedia')}
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
        <FlatList
          data={media}
          keyExtractor={(m) => m.message_id}
          numColumns={NUM_COLUMNS}
          contentContainerStyle={media.length === 0 ? styles.emptyContent : styles.grid}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <Pressable
              style={styles.thumb}
              onPress={() =>
                navigation.navigate('MediaViewer', {
                  url: mediaUrl(item.url) ?? item.url,
                  type: item.type === 'video' ? 'video' : 'image',
                })
              }
            >
              <Image source={{ uri: mediaUrl(item.url) }} style={styles.thumbImg} />
              {item.type === 'video' ? (
                <View style={styles.playBadge}>
                  <Icon name="play" size={12} color="#fff" />
                </View>
              ) : null}
            </Pressable>
          )}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="image-multiple-outline" size={40} color={c.textFaint} />
              <Text style={[styles.emptyTxt, { color: c.textFaint }]}>{t('chat.noSharedMedia')}</Text>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const THUMB_SIZE = 100;

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingTop: 60 },
  emptyContent: { flexGrow: 1 },
  emptyTxt: { fontSize: 14 },
  grid: { paddingBottom: 20 },
  footerLoading: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  thumb: { width: THUMB_SIZE, height: THUMB_SIZE, margin: 1 },
  thumbImg: { width: '100%', height: '100%' },
  playBadge: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
