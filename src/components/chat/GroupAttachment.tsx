/**
 * Rendu d'une pièce jointe de message de GROUPE, avec le modèle WhatsApp de
 * téléchargement à la demande (vidéo / vocal / document : miniature + poids +
 * un bouton, téléchargement au tap, stockage local persistant).
 *
 * Les images suivent le réglage Wi-Fi/données via `<CachedImage>`.
 */
import React, { useCallback } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CachedImage, Icon, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { LocalGroupMessage } from '@/db/repositories/groupRepo';
import { useCachedMedia } from '@/hooks/useCachedMedia';
import { mediaCache } from '@/services/mediaCache';
import { mediaUrl } from '@/utils/media';
import { VoiceNoteBubble } from './VoiceNoteBubble';

function num(meta: Record<string, unknown> | null | undefined, k: string): number | null {
  const v = meta?.[k];
  return typeof v === 'number' ? v : null;
}
function str(meta: Record<string, unknown> | null | undefined, k: string): string | null {
  const v = meta?.[k];
  return typeof v === 'string' ? v : null;
}
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

interface Props {
  message: LocalGroupMessage;
  mine: boolean;
  onOpenMedia: (localOrRemoteUrl: string, type: 'image' | 'video') => void;
}

export const GroupAttachment: React.FC<Props> = ({ message, mine, onOpenMedia }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const meta = message.attachment_meta ?? null;
  const url = message.attachment_url ?? null;
  const cached = useCachedMedia(url);
  const size = num(meta, 'size');
  const fg = mine ? c.bubbleOutText : c.bubbleInText;

  const openFile = useCallback(async () => {
    const local =
      mediaCache.localFor(url) ?? (await mediaCache.fetchNow(url));
    const target = local ?? mediaUrl(url ?? undefined);
    if (target) void Linking.openURL(target).catch(() => showAlert(t('errors.generic')));
  }, [url, t]);

  if (!url) return null;

  // ── IMAGE : auto selon réglage ───────────────────────────────────────
  if (message.type === 'image') {
    return (
      <Pressable
        onPress={() => onOpenMedia(mediaCache.localFor(url) ?? mediaUrl(url) ?? url, 'image')}
        style={styles.wrap}
      >
        <CachedImage
          uri={str(meta, 'thumbnail_url') ?? url}
          style={styles.img}
          resizeMode="cover"
        />
        {message.pending ? (
          <View style={styles.pending}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : null}
      </Pressable>
    );
  }

  // ── VIDÉO : miniature + poids + bouton telecharger ; téléchargement au tap ────────────
  if (message.type === 'video') {
    const ready = !!cached.localUri;
    return (
      <Pressable
        onPress={() => {
          if (message.pending) return;
          if (ready) onOpenMedia(cached.localUri as string, 'video');
          else void cached.download();
        }}
        style={styles.wrap}
      >
        {str(meta, 'thumbnail_url') ? (
          <CachedImage uri={mediaUrl(str(meta, 'thumbnail_url') ?? undefined)} style={styles.img} resizeMode="cover" />
        ) : (
          <View style={[styles.img, styles.videoPlaceholder]} />
        )}
        {message.pending ? (
          <View style={styles.pending}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : ready ? (
          <View style={styles.overlay}>
            <View style={styles.playChip}>
              <Icon name="play" size={22} color="#fff" />
            </View>
          </View>
        ) : (
          <View style={styles.overlay}>
            <View style={styles.dlChip}>
              {cached.downloading ? (
                <>
                  <ActivityIndicator color="#fff" size="small" />
                  <Text style={styles.dlChipText}>{Math.round(cached.progress * 100)}%</Text>
                </>
              ) : (
                <>
                  <Icon name="download" size={18} color="#fff" />
                  {size ? <Text style={styles.dlChipText}>{humanSize(size)}</Text> : null}
                </>
              )}
            </View>
          </View>
        )}
      </Pressable>
    );
  }

  // ── VOCAL ────────────────────────────────────────────────────────────
  if (message.type === 'voice') {
    return (
      <VoiceNoteBubble
        url={url}
        durationSec={num(meta, 'duration_sec')}
        sizeBytes={size}
        mine={mine}
        fg={fg}
      />
    );
  }

  // ── DOCUMENT ─────────────────────────────────────────────────────────
  if (message.type === 'file') {
    const name = str(meta, 'name') ?? t('chat.file');
    const ready = !!cached.localUri;
    return (
      <Pressable onPress={openFile} style={styles.fileRow}>
        <View style={[styles.fileIcon, { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : c.primary + '18' }]}>
          {cached.downloading ? (
            <ActivityIndicator color={fg} size="small" />
          ) : (
            <Icon name={ready ? 'file-document-outline' : 'download'} size={22} color={fg} />
          )}
        </View>
        <View style={styles.fileText}>
          <Text style={[styles.fileName, { color: fg }]} numberOfLines={1}>
            {name}
          </Text>
          <Text style={[styles.fileMeta, { color: fg }]}>
            {cached.downloading
              ? `${Math.round(cached.progress * 100)} %`
              : ready
                ? humanSize(size) || t('chat.file')
                : [humanSize(size), t('chat.tapToDownload')].filter(Boolean).join(' · ')}
          </Text>
        </View>
      </Pressable>
    );
  }

  return null;
};

const styles = StyleSheet.create({
  wrap: {
    width: 230,
    maxWidth: '100%',
    aspectRatio: 1.3,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  img: { width: '100%', height: '100%' },
  videoPlaceholder: { backgroundColor: '#1E293B' },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  playChip: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dlChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,0,0,0.6)',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  dlChipText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pending: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 2 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  fileText: { flexShrink: 1, flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 11, marginTop: 1, opacity: 0.65 },
});
