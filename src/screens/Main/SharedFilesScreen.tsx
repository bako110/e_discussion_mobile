/**
 * Page dédiée aux FICHIERS partagés dans une conversation — façon WhatsApp :
 * contrairement aux photos/vidéos (grille dans `ConversationInfoScreen`),
 * les documents ont toujours été listés à part ici, jamais mélangés.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { conversationService } from '@/services';
import { mediaCache } from '@/services/mediaCache';
import type { SharedMedia } from '@/types';
import { dayLabel, clockTime } from '@/utils/time';

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return '';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

// Le serveur plafonne `limit` à 100 (Pagination, voir app/api/deps.py côté
// backend) — une valeur au-delà est REJETÉE (422 Unprocessable Entity), pas
// juste tronquée : d'où un écran "vide" silencieux avant ce fix (l'erreur
// réseau était avalée par le catch générique). Pagination réelle plutôt
// qu'une grosse page unique pour rester valide même avec beaucoup de fichiers.
const PAGE_LIMIT = 60;

export const SharedFilesScreen: React.FC<MainScreenProps<'SharedFiles'>> = ({ route, navigation }) => {
  const { conversationId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [files, setFiles] = useState<SharedMedia[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const first = await conversationService.media(conversationId, 1, PAGE_LIMIT);
      setFiles(first.filter((m) => m.type === 'file'));
      setPage(1);
      setHasMore(first.length >= PAGE_LIMIT);
    } catch {
      /* hors-ligne — page vide, pas de cache local dédié pour cet écran */
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
      setFiles((cur) => [...cur, ...raw.filter((m) => m.type === 'file')]);
    } catch {
      /* échec réseau : on retentera au prochain onEndReached */
    } finally {
      setLoadingMore(false);
    }
  }, [conversationId, page, hasMore, loadingMore]);

  useEffect(() => {
    void load();
  }, [load]);

  const openFile = async (m: SharedMedia) => {
    setDownloadingId(m.message_id);
    try {
      const local = mediaCache.localFor(m.url) ?? (await mediaCache.fetchNow(m.url));
      const target = local ?? m.url;
      if (target) await Linking.openURL(target);
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('chat.filesTitle')}
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
          data={files}
          keyExtractor={(m) => m.message_id}
          contentContainerStyle={files.length === 0 ? styles.emptyContent : styles.list}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.border }]} />}
          onEndReachedThreshold={0.4}
          onEndReached={() => void loadMore()}
          ListFooterComponent={
            loadingMore ? (
              <View style={styles.footerLoading}>
                <ActivityIndicator size="small" color={c.primary} />
              </View>
            ) : null
          }
          renderItem={({ item }) => {
            const meta = item.meta ?? null;
            const name = (typeof meta?.name === 'string' && meta.name) || t('chat.file');
            const size = humanSize(typeof meta?.size === 'number' ? meta.size : null);
            const busy = downloadingId === item.message_id;
            return (
              <Pressable
                style={styles.row}
                onPress={() => void openFile(item)}
                disabled={busy}
                android_ripple={{ color: c.surfaceAlt }}
              >
                <View style={[styles.icon, { backgroundColor: c.primary + '18' }]}>
                  {busy ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Icon name="file-document-outline" size={22} color={c.primary} />
                  )}
                </View>
                <View style={styles.info}>
                  <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  <Text style={[styles.meta, { color: c.textFaint }]}>
                    {[dayLabel(item.created_at), clockTime(item.created_at), size].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <View style={styles.center}>
              <Icon name="file-document-outline" size={40} color={c.textFaint} />
              <Text style={[styles.emptyTxt, { color: c.textFaint }]}>{t('chat.noSharedFiles')}</Text>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  emptyContent: { flexGrow: 1 },
  emptyTxt: { fontSize: 14 },
  list: { paddingVertical: 4 },
  footerLoading: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 68 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 12 },
  icon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, gap: 2 },
  name: { fontSize: 15, fontWeight: '600' },
  meta: { fontSize: 12.5 },
});
