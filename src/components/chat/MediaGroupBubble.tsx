/**
 * Grille d'images envoyées ENSEMBLE (façon WhatsApp) — regroupement purement
 * VISUEL de plusieurs messages consécutifs du même expéditeur (voir
 * `groupConsecutiveImages` dans ChatScreen.tsx), pas un seul message : chaque
 * image reste indépendante en base/sync.
 *
 * Disposition : 1 image = pleine largeur, 2 = côte à côte, 3-4 = grille 2x2,
 * 5+ = grille 2x2 avec un badge "+N" sur la dernière vignette visible.
 * Tap sur une vignette -> viewer plein écran avec flèches précédent/suivant
 * pour défiler dans le groupe (voir MediaViewerScreen, prop `gallery`).
 *
 * Chaque tuile respecte le réglage "téléchargement auto" (comme une image
 * seule dans MessageBubble) : si le fichier n'est pas déjà en cache et que
 * l'auto-download est coupé pour ce type de réseau, elle affiche un chip
 * "poids + télécharger" plutôt que de forcer le téléchargement — voir
 * `useCachedMedia`, même hook que pour une vidéo/fichier isolé. Un bouton
 * "Tout télécharger" (façon WhatsApp) apparaît dans le pied de la grille dès
 * qu'au moins une image du groupe n'est pas encore en cache.
 */
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { CachedImage, Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { useCachedMedia, type CachedMedia } from '@/hooks/useCachedMedia';
import { clockTime } from '@/utils/time';
import { mediaUrl } from '@/utils/media';
import { useTranslation } from 'react-i18next';

interface Props {
  messages: LocalMessage[]; // ordre chronologique du + ancien au + récent
  mine: boolean;
  onOpenAt: (index: number) => void;
  onLongPress?: (m: LocalMessage) => void;
}

const MAX_VISIBLE = 4;
const GAP = 2;
const BORDER_WIDTH = 1;
const GRID_SIZE = 220;
// espace utile réel à l'intérieur du conteneur (la bordure mange 1px de
// chaque côté) — sans ce -2*BORDER_WIDTH, deux tuiles de 109px + 2px de gap
// dépassaient légèrement les 218px disponibles, laissant un vide visible.
const INNER_SIZE = GRID_SIZE - 2 * BORDER_WIDTH;
const HALF = (INNER_SIZE - GAP) / 2;

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

function thumbFor(m: LocalMessage): string | undefined {
  const meta = m.attachment_meta ?? null;
  const t = typeof meta?.thumbnail_url === 'string' ? (meta.thumbnail_url as string) : undefined;
  return mediaUrl(t ?? m.attachment_url ?? undefined);
}

function sizeFor(m: LocalMessage): number | null {
  const v = m.attachment_meta?.size;
  return typeof v === 'number' ? v : null;
}

const GroupTile: React.FC<{
  message: LocalMessage;
  cached: CachedMedia;
  style: object;
  overlayLabel: number | null; // "+N" si dernière tuile visible avec overflow
  onOpen: () => void;
  onLongPress: () => void;
}> = ({ message, cached, style, overlayLabel, onOpen, onLongPress }) => {
  const ready = !!cached.localUri || !!message.pending;

  const onPress = () => {
    if (message.pending) return;
    // non téléchargé (auto-download coupé) -> tap = télécharger, PAS ouvrir
    // un viewer vide, exactement comme pour une vidéo/fichier isolé.
    if (ready) onOpen();
    else void cached.download();
  };

  return (
    <Pressable onPress={onPress} onLongPress={onLongPress} style={style}>
      {ready ? (
        <CachedImage uri={thumbFor(message)} style={styles.tileImg} resizeMode="cover" />
      ) : (
        <View style={[styles.tileImg, styles.tilePlaceholder]} />
      )}

      {message.pending ? (
        <View style={styles.centerOverlay}>
          <ActivityIndicator color="#fff" size="small" />
        </View>
      ) : !ready ? (
        <View style={styles.centerOverlay}>
          <View style={styles.dlChip}>
            {cached.downloading ? (
              <>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.dlChipText}>{Math.round(cached.progress * 100)}%</Text>
              </>
            ) : (
              <>
                <Icon name="download" size={16} color="#fff" />
                {sizeFor(message) ? (
                  <Text style={styles.dlChipText}>{humanSize(sizeFor(message))}</Text>
                ) : null}
              </>
            )}
          </View>
        </View>
      ) : null}

      {overlayLabel !== null ? (
        <View style={styles.overflowOverlay}>
          <Text style={styles.overflowTxt}>+{overlayLabel}</Text>
        </View>
      ) : null}
    </Pressable>
  );
};

/** Un hook par position fixe (0..MAX_VISIBLE-1) — nombre d'appels stable
 * entre rendus (règle des hooks), `messages[i]` change juste de valeur. */
function useTileCache(messages: LocalMessage[], i: number): CachedMedia {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useCachedMedia(messages[i]?.attachment_url);
}

export const MediaGroupBubble: React.FC<Props> = ({ messages, mine, onOpenAt, onLongPress }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const count = messages.length;
  const visible = messages.slice(0, MAX_VISIBLE);
  const overflow = count - MAX_VISIBLE;
  const last = messages[messages.length - 1]!;
  const anyPending = messages.some((m) => m.pending);

  // un hook par SLOT (position 0..3), jamais par message — respecte la règle
  // des hooks même quand `visible.length` varie d'un groupe à l'autre.
  const cache0 = useTileCache(visible, 0);
  const cache1 = useTileCache(visible, 1);
  const cache2 = useTileCache(visible, 2);
  const cache3 = useTileCache(visible, 3);
  const caches = [cache0, cache1, cache2, cache3].slice(0, visible.length);

  const pendingDownloads = caches.filter((cd, i) => !cd.localUri && !visible[i]!.pending);
  const anyDownloading = pendingDownloads.some((cd) => cd.downloading);
  const showDownloadAll = pendingDownloads.length > 0;

  const downloadAll = () => {
    for (const cd of pendingDownloads) void cd.download();
  };

  const tileStyle = (i: number) => {
    if (count === 1) return styles.tileFull;
    if (count === 2) return styles.tileHalf;
    return styles.tileQuarter;
  };

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
      <View
        style={[
          styles.grid,
          count === 1 && styles.gridSingle,
          { borderColor: mine ? c.bubbleOut : c.bubbleIn },
        ]}
      >
        {visible.map((m, i) => {
          const isLastVisible = i === MAX_VISIBLE - 1 && overflow > 0;
          return (
            <GroupTile
              key={m.id}
              message={m}
              cached={caches[i]!}
              style={tileStyle(i)}
              overlayLabel={isLastVisible ? overflow : null}
              onOpen={() => onOpenAt(messages.indexOf(m))}
              onLongPress={() => onLongPress?.(m)}
            />
          );
        })}
      </View>

      <View style={styles.footer}>
        {anyPending ? <Icon name="clock-outline" size={11} color={c.textFaint} /> : null}
        <Text style={[styles.count, { color: c.textFaint }]}>{count}</Text>
        <Icon name="image-multiple-outline" size={12} color={c.textFaint} />
        <Text style={[styles.time, { color: c.textFaint }]}>{clockTime(last.created_at)}</Text>
        {showDownloadAll ? (
          <Pressable onPress={downloadAll} disabled={anyDownloading} style={styles.downloadAllBtn} hitSlop={6}>
            {anyDownloading ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Icon name="download-multiple" size={13} color={c.primary} />
            )}
            <Text style={[styles.downloadAllTxt, { color: c.primary }]}>
              {t('chat.downloadAll')}
            </Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  row: { marginVertical: 2, maxWidth: '78%' },
  rowMine: { alignSelf: 'flex-end' },
  rowTheirs: { alignSelf: 'flex-start' },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    width: GRID_SIZE,
    height: GRID_SIZE,
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: BORDER_WIDTH,
    gap: GAP,
  },
  gridSingle: { height: undefined, aspectRatio: 1 },
  tileFull: { width: '100%', height: '100%' },
  tileHalf: { width: HALF, height: INNER_SIZE },
  tileQuarter: { width: HALF, height: HALF },
  tileImg: { width: '100%', height: '100%', backgroundColor: '#1a1a1a' },
  tilePlaceholder: { backgroundColor: '#1a1a1a' },
  centerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dlChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  dlChipText: { color: '#fff', fontSize: 10.5, fontWeight: '700' },
  overflowOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  overflowTxt: { color: '#fff', fontSize: 20, fontWeight: '800' },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 3,
    paddingHorizontal: 2,
    width: GRID_SIZE,
  },
  count: { fontSize: 11, fontWeight: '600' },
  time: { fontSize: 11, marginLeft: 'auto' },
  downloadAllBtn: { flexDirection: 'row', alignItems: 'center', gap: 3, marginLeft: 8 },
  downloadAllTxt: { fontSize: 11, fontWeight: '700' },
});
