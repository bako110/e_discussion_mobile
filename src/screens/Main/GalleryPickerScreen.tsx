/**
 * Galerie MAISON avec sélection multiple par case à cocher — remplace le
 * sélecteur système (dont le comportement multi-choix n'est pas fiable
 * selon l'OEM/version Android) par une grille propre à l'app, façon
 * `SelectContactsScreen` : on tape une photo pour la cocher/décocher, un
 * badge numéroté montre l'ordre choisi, puis « Envoyer (N) » valide.
 *
 * Ouvert via `pickGalleryMultiple()` (pont impératif à base de token, comme
 * `selectContacts`) : la promesse résout la liste des fichiers locaux
 * choisis, ou `null` si annulé.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  FlatList,
  Image,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { CameraRoll, type PhotoIdentifier } from '@react-native-camera-roll/camera-roll';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { navigationRef } from '@/navigation/navigationRef';
import type { MainScreenProps } from '@/navigation/types';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';

const PAGE_SIZE = 60;
const COLS = 4;
const GAP = 2;
const { width: SCREEN_W } = Dimensions.get('window');
const TILE_SIZE = (SCREEN_W - GAP * (COLS - 1)) / COLS;

// ── pont impératif <-> écran (même pattern que `selectContacts`) ─────────
const _pending = new Map<string, (files: LocalMediaFile[] | null) => void>();
let _seq = 0;

export function pickGalleryMultiple(opts?: { maxCount?: number }): Promise<LocalMediaFile[] | null> {
  return new Promise((resolve) => {
    if (!navigationRef.isReady()) {
      resolve(null);
      return;
    }
    const token = `gal_${Date.now()}_${_seq++}`;
    _pending.set(token, resolve);
    navigationRef.navigate('GalleryPicker', { token, maxCount: opts?.maxCount });
  });
}

function resolvePick(token: string, files: LocalMediaFile[] | null): void {
  const fn = _pending.get(token);
  if (fn) {
    _pending.delete(token);
    fn(files);
  }
}

async function ensureGalleryPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    // Android 13+ (API 33) : permission granulaire dédiée aux images.
    // En dessous : READ_EXTERNAL_STORAGE.
    const perm =
      Platform.Version >= 33
        ? PermissionsAndroid.PERMISSIONS.READ_MEDIA_IMAGES
        : PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
    const res = await PermissionsAndroid.request(perm, {
      title: 'Photos',
      message: "L'accès à vos photos est nécessaire pour en choisir plusieurs à envoyer.",
      buttonPositive: 'OK',
      buttonNegative: 'Annuler',
    });
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

function toLocalMediaFile(item: PhotoIdentifier): LocalMediaFile {
  const node = item.node;
  const filename = node.image.filename || node.image.uri.split('/').pop() || `photo_${Date.now()}.jpg`;
  return {
    file: { uri: node.image.uri, name: filename, type: 'image/jpeg' },
    kind: 'image',
    size: node.image.fileSize ?? null,
    width: node.image.width ?? null,
    height: node.image.height ?? null,
    durationSec: null,
  };
}

export const GalleryPickerScreen: React.FC<MainScreenProps<'GalleryPicker'>> = ({
  route,
  navigation,
}) => {
  const { token, maxCount = 20 } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [photos, setPhotos] = useState<PhotoIdentifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | undefined>(undefined);
  // ordre de sélection : uri -> rang (1, 2, 3…) pour le badge numéroté
  const [selected, setSelected] = useState<Map<string, number>>(new Map());

  const answered = useRef(false);
  const answer = useCallback(
    (files: LocalMediaFile[] | null) => {
      if (answered.current) return;
      answered.current = true;
      resolvePick(token, files);
    },
    [token],
  );
  useEffect(() => navigation.addListener('beforeRemove', () => answer(null)), [navigation, answer]);

  const loadPage = useCallback(async (after?: string) => {
    const res = await CameraRoll.getPhotos({
      first: PAGE_SIZE,
      after,
      assetType: 'Photos',
      include: ['filename', 'fileSize', 'imageSize'],
    });
    return res;
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const granted = await ensureGalleryPermission();
      if (!alive) return;
      if (!granted) {
        setPermissionDenied(true);
        setLoading(false);
        return;
      }
      try {
        const res = await loadPage();
        if (!alive) return;
        setPhotos(res.edges);
        setHasMore(res.page_info.has_next_page);
        cursorRef.current = res.page_info.end_cursor ?? undefined;
      } catch (e) {
        console.warn('[gallery-picker] load failed:', e);
        showAlert(t('errors.generic'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [loadPage, t]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore || loading) return;
    setLoadingMore(true);
    try {
      const res = await loadPage(cursorRef.current);
      setPhotos((prev) => [...prev, ...res.edges]);
      setHasMore(res.page_info.has_next_page);
      cursorRef.current = res.page_info.end_cursor ?? undefined;
    } catch (e) {
      console.warn('[gallery-picker] loadMore failed:', e);
    } finally {
      setLoadingMore(false);
    }
  }, [loadPage, loadingMore, hasMore, loading]);

  const toggle = (uri: string) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(uri)) {
        next.delete(uri);
        // renumérote les rangs restants pour rester consécutifs (1..N)
        const entries = [...next.entries()].sort((a, b) => a[1] - b[1]);
        entries.forEach(([u], i) => next.set(u, i + 1));
      } else {
        if (next.size >= maxCount) {
          showAlert(t('chat.multiMaxReached', { max: maxCount }));
          return prev;
        }
        next.set(uri, next.size + 1);
      }
      return next;
    });
  };

  const confirm = () => {
    const byUri = new Map(photos.map((p) => [p.node.image.uri, p]));
    const ordered = [...selected.entries()].sort((a, b) => a[1] - b[1]);
    const files = ordered
      .map(([uri]) => byUri.get(uri))
      .filter((p): p is PhotoIdentifier => !!p)
      .map(toLocalMediaFile);
    answer(files);
    navigation.goBack();
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('chat.attachMultiplePhotos')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          selected.size > 0 ? (
            <Pressable onPress={confirm} hitSlop={12} style={styles.hdrBtn}>
              <Text style={[styles.sendTxt, { color: c.onHeader }]}>
                {t('chat.multiSend', { count: selected.size })}
              </Text>
            </Pressable>
          ) : null
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : permissionDenied ? (
        <View style={styles.center}>
          <Icon name="image-off-outline" size={40} color={c.textFaint} />
          <Text style={[styles.emptyTxt, { color: c.textMuted }]}>
            {t('chat.galleryPermissionDenied')}
          </Text>
        </View>
      ) : (
        <FlatList
          data={photos}
          numColumns={COLS}
          keyExtractor={(item) => item.node.image.uri}
          contentContainerStyle={{ paddingBottom: insets.bottom + (selected.size > 0 ? 70 : 16) }}
          onEndReached={loadMore}
          onEndReachedThreshold={0.5}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerLoader} color={c.primary} /> : null}
          renderItem={({ item }) => {
            const uri = item.node.image.uri;
            const rank = selected.get(uri);
            const isSelected = rank !== undefined;
            return (
              <Pressable onPress={() => toggle(uri)} style={styles.tile}>
                <Image source={{ uri }} style={styles.tileImg} />
                <View style={[styles.overlay, isSelected && { backgroundColor: 'rgba(0,0,0,0.25)' }]} />
                <View
                  style={[
                    styles.checkCircle,
                    isSelected
                      ? { backgroundColor: c.primary, borderColor: c.primary }
                      : { borderColor: '#fff' },
                  ]}
                >
                  {isSelected ? <Text style={styles.checkRank}>{rank}</Text> : null}
                </View>
              </Pressable>
            );
          }}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { paddingHorizontal: 4, minWidth: 40, alignItems: 'center' },
  sendTxt: { fontSize: 14, fontWeight: '800' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 24 },
  emptyTxt: { fontSize: 14, textAlign: 'center' },
  footerLoader: { marginVertical: 16 },
  tile: {
    width: TILE_SIZE,
    height: TILE_SIZE,
    marginRight: GAP,
    marginBottom: GAP,
  },
  tileImg: { width: '100%', height: '100%', backgroundColor: '#1a1a1a' },
  overlay: { ...StyleSheet.absoluteFillObject },
  checkCircle: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkRank: { color: '#fff', fontSize: 11, fontWeight: '800' },
});
