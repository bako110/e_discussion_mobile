import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { CachedImage, Icon } from '@/components/common';
import { useChatPrefs } from '@/context/ChatPrefsContext';
import { useTheme } from '@/context/ThemeContext';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { useCachedMedia } from '@/hooks/useCachedMedia';
import { clockTime } from '@/utils/time';
import { mediaUrl } from '@/utils/media';
import { VoiceNoteBubble } from './VoiceNoteBubble';

interface Props {
  message: LocalMessage;
  mine: boolean;
  grouped?: boolean; // suit un message du même expéditeur → coins/queue adaptés
  onLongPress?: () => void;
  onRetry?: () => void;
  /** Ouvre le viewer plein écran pour une image/vidéo. */
  onOpenMedia?: (m: LocalMessage) => void;
  /** Ouvre un document (PDF / fichier) dans un lecteur externe. */
  onOpenFile?: (m: LocalMessage) => void;
  /** Ouvre la position partagée dans une app de cartes. */
  onOpenLocation?: (lat: number, lng: number) => void;
}

function metaNum(meta: Record<string, unknown> | null, key: string): number | null {
  const v = meta?.[key];
  return typeof v === 'number' ? v : null;
}
function metaStr(meta: Record<string, unknown> | null, key: string): string | null {
  const v = meta?.[key];
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

/** Coche d'état pour mes messages : en attente / envoyé / remis / lu / échec.
 * `readColor` : teinte accentuée quand le message est LU (double coche colorée
 * façon WhatsApp) ; le reste garde la teinte discrète `color`. */
const StatusTick: React.FC<{ m: LocalMessage; color: string; readColor: string }> = ({
  m,
  color,
  readColor,
}) => {
  if (m.sync_state === 'failed') return <Icon name="alert-circle-outline" size={13} color={color} />;
  if (m.sync_state === 'pending') return <Icon name="clock-outline" size={12} color={color} />;
  if (m.read) return <Icon name="check-all" size={14} color={readColor} />;
  if (m.delivered) return <Icon name="check-all" size={14} color={color} />;
  return <Icon name="check" size={13} color={color} />;
};

export const MessageBubble: React.FC<Props> = ({
  message,
  mine,
  grouped,
  onLongPress,
  onRetry,
  onOpenMedia,
  onOpenFile,
  onOpenLocation,
}) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { fontScale } = useChatPrefs();
  const c = theme.colors;

  // état du fichier joint vis-à-vis du cache disque persistant (hook : avant tout return)
  const cached = useCachedMedia(message.attachment_url);

  if (message.deleted_at) {
    return (
      <View style={[styles.row, mine ? styles.rowMine : styles.rowTheirs]}>
        <View style={[styles.bubble, styles.deleted, { borderColor: c.border }]}>
          <Icon name="cancel" size={13} color={c.textFaint} />
          <Text style={{ color: c.textFaint, fontStyle: 'italic', marginLeft: 4 }}>—</Text>
        </View>
      </View>
    );
  }

  const bg = mine ? c.bubbleOut : c.bubbleIn;
  const fg = mine ? c.bubbleOutText : c.bubbleInText;
  const failed = message.sync_state === 'failed';

  const bubbleRadius = {
    borderTopLeftRadius: mine ? 18 : grouped ? 6 : 18,
    borderTopRightRadius: mine ? (grouped ? 6 : 18) : 18,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  };

  const meta = message.attachment_meta ?? null;
  const url = message.attachment_url;
  const isMediaType = message.type === 'image' || message.type === 'video';
  const isVoice = message.type === 'voice';
  const isFile = message.type === 'file';
  const isLocation = message.type === 'location';
  const hasAttachment = !!url || isLocation;

  // pour une image/vidéo sans légende, la bulle colle au média (pas de fond)
  const bareMedia = isMediaType && hasAttachment && !message.body;
  const thumb = mediaUrl(metaStr(meta, 'thumbnail_url') ?? url ?? undefined);
  const ratio =
    (metaNum(meta, 'width') ?? 0) > 0 && (metaNum(meta, 'height') ?? 0) > 0
      ? (metaNum(meta, 'width') as number) / (metaNum(meta, 'height') as number)
      : 1;

  const attSize = metaNum(meta, 'size');

  const renderAttachment = () => {
    // ── IMAGE : auto-download selon réglage (CachedImage gère tout) ──────
    if (message.type === 'image' && hasAttachment) {
      return (
        <Pressable
          onPress={() => onOpenMedia?.(message)}
          onLongPress={onLongPress}
          style={[styles.mediaWrap, { aspectRatio: Math.max(0.6, Math.min(1.9, ratio)) }]}
        >
          <CachedImage uri={thumb} style={styles.mediaImg} resizeMode="cover" />
          {message.pending ? (
            <View style={styles.mediaPending}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : null}
        </Pressable>
      );
    }

    // ── VIDÉO : miniature + poids + bouton telecharger ; téléchargement au tap ───────────
    if (message.type === 'video' && hasAttachment) {
      const localVideoPending = message.pending && (cached.localUri ?? '').startsWith('file:') === false;
      const ready = !!cached.localUri;
      return (
        <Pressable
          onPress={() => {
            if (message.pending) return;
            if (ready) onOpenMedia?.(message);
            else void cached.download();
          }}
          onLongPress={onLongPress}
          style={[styles.mediaWrap, { aspectRatio: Math.max(0.6, Math.min(1.9, ratio)) }]}
        >
          {localVideoPending || !metaStr(meta, 'thumbnail_url') ? (
            <View style={[styles.mediaImg, styles.videoPlaceholder]} />
          ) : (
            <CachedImage uri={mediaUrl(metaStr(meta, 'thumbnail_url') ?? undefined)} style={styles.mediaImg} resizeMode="cover" />
          )}

          {message.pending ? (
            <View style={styles.mediaPending}>
              <ActivityIndicator color="#fff" />
            </View>
          ) : ready ? (
            <View style={styles.playOverlay}>
              <View style={styles.playChip}>
                <Icon name="play" size={24} color="#fff" />
              </View>
            </View>
          ) : (
            <View style={styles.playOverlay}>
              <View style={styles.dlChip}>
                {cached.downloading ? (
                  <>
                    <ActivityIndicator color="#fff" size="small" />
                    <Text style={styles.dlChipText}>
                      {Math.round(cached.progress * 100)}%
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon name="download" size={18} color="#fff" />
                    {attSize ? (
                      <Text style={styles.dlChipText}>{humanSize(attSize)}</Text>
                    ) : null}
                  </>
                )}
              </View>
            </View>
          )}
        </Pressable>
      );
    }

    if (isVoice) {
      return (
        <VoiceNoteBubble
          url={url}
          durationSec={metaNum(meta, 'duration_sec')}
          sizeBytes={attSize}
          mine={mine}
          fg={fg}
          messageId={message.id}
        />
      );
    }
    if (isFile) {
      const name = metaStr(meta, 'name') ?? t('chat.file');
      const size = humanSize(attSize);
      const ready = !!cached.localUri;
      return (
        <Pressable
          onPress={() => {
            if (ready) onOpenFile?.(message);
            else void cached.download();
          }}
          style={styles.fileRow}
        >
          <View style={[styles.fileIcon, { backgroundColor: mine ? 'rgba(255,255,255,0.18)' : c.primary + '18' }]}>
            {cached.downloading ? (
              <ActivityIndicator color={fg} size="small" />
            ) : (
              <Icon name={ready ? 'file-document-outline' : 'download'} size={22} color={fg} />
            )}
          </View>
          <View style={styles.flexShrink}>
            <Text style={[styles.fileName, { color: fg }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.fileMeta, { color: fg, opacity: 0.65 }]}>
              {cached.downloading
                ? `${Math.round(cached.progress * 100)} %`
                : ready
                  ? size || t('chat.file')
                  : [size, t('chat.tapToDownload')].filter(Boolean).join(' · ')}
            </Text>
          </View>
        </Pressable>
      );
    }
    if (isLocation) {
      const lat = metaNum(meta, 'latitude') ?? metaNum(meta, 'lat');
      const lng = metaNum(meta, 'longitude') ?? metaNum(meta, 'lng');
      return (
        <Pressable
          onPress={() => (lat != null && lng != null ? onOpenLocation?.(lat, lng) : undefined)}
          style={styles.locWrap}
        >
          <View style={[styles.locMap, { backgroundColor: mine ? 'rgba(255,255,255,0.14)' : c.surfaceAlt }]}>
            <Icon name="map-marker" size={30} color={mine ? '#fff' : c.primary} />
          </View>
          <View style={styles.locText}>
            <Text style={[styles.fileName, { color: fg }]}>{t('chat.locationShared')}</Text>
            {lat != null && lng != null ? (
              <Text style={[styles.fileMeta, { color: fg, opacity: 0.65 }]} numberOfLines={1}>
                {lat.toFixed(5)}, {lng.toFixed(5)}
              </Text>
            ) : null}
            <Text style={[styles.locOpen, { color: mine ? '#fff' : c.primary }]}>
              {t('chat.openInMaps')}
            </Text>
          </View>
        </Pressable>
      );
    }
    return null;
  };

  return (
    <Pressable
      onLongPress={onLongPress}
      onPress={failed ? onRetry : undefined}
      style={[styles.row, mine ? styles.rowMine : styles.rowTheirs, { marginTop: grouped ? 2 : 6 }]}
    >
      <View
        style={[
          styles.bubble,
          bubbleRadius,
          { backgroundColor: bg },
          bareMedia && styles.bubbleBare,
        ]}
      >
        {message.reply_to ? (
          <View style={[styles.reply, { borderLeftColor: mine ? '#ffffffaa' : c.primary }]}>
            <Text style={{ color: fg, opacity: 0.85, fontSize: 13 }} numberOfLines={1}>
              {message.reply_to.body || `[${message.reply_to.type}]`}
            </Text>
          </View>
        ) : null}

        {hasAttachment ? renderAttachment() : null}

        {message.decryptFailed && !message.body ? (
          <View style={styles.encryptedRow}>
            <Icon name="lock-alert-outline" size={14} color={fg} />
            <Text
              style={[
                styles.body,
                { color: fg, fontStyle: 'italic', opacity: 0.85, fontSize: 15 * fontScale },
              ]}
            >
              {t('conversations.encryptedMessage')}
            </Text>
          </View>
        ) : message.body ? (
          <Text
            style={[
              styles.body,
              { color: fg, fontSize: 15 * fontScale },
              hasAttachment && { marginTop: 6 },
            ]}
          >
            {message.body}
          </Text>
        ) : null}

        <View style={[styles.meta, bareMedia && styles.metaOnMedia]}>
          {message.edited_at ? (
            <Text style={[styles.metaText, { color: bareMedia ? '#fff' : fg, opacity: 0.6 }]}>
              {t('common.edit').toLowerCase()} ·{' '}
            </Text>
          ) : null}
          <Text style={[styles.metaText, { color: bareMedia ? '#fff' : fg, opacity: 0.75 }]}>
            {clockTime(message.created_at)}
          </Text>
          {mine ? (
            <View style={{ marginLeft: 4 }}>
              <StatusTick
                m={message}
                color={failed ? c.danger : bareMedia ? '#fff' : fg}
                readColor={bareMedia ? '#fff' : '#7FD0FF'}
              />
            </View>
          ) : null}
        </View>

        {message.reaction ? (
          <View style={[styles.reaction, { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={{ fontSize: 13 }}>{message.reaction}</Text>
          </View>
        ) : null}
      </View>

      {failed ? (
        <Text style={[styles.failedHint, { color: c.danger }]}>{t('sync.failed')}</Text>
      ) : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { paddingHorizontal: 12, flexDirection: 'column' },
  rowMine: { alignItems: 'flex-end' },
  rowTheirs: { alignItems: 'flex-start' },
  bubble: { maxWidth: '82%', paddingHorizontal: 12, paddingVertical: 8, overflow: 'hidden' },
  bubbleBare: { padding: 3 },
  deleted: { borderWidth: 1, backgroundColor: 'transparent', flexDirection: 'row', alignItems: 'center', borderRadius: 18 },
  reply: { borderLeftWidth: 3, paddingLeft: 8, marginBottom: 4, opacity: 0.9 },
  encryptedRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  body: { fontSize: 15, lineHeight: 21, flexShrink: 1 },
  meta: { flexDirection: 'row', alignSelf: 'flex-end', marginTop: 2, alignItems: 'center' },
  metaOnMedia: {
    position: 'absolute',
    bottom: 8,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.38)',
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  metaText: { fontSize: 11 },
  mediaWrap: {
    width: 230,
    maxWidth: '100%',
    borderRadius: 15,
    overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.06)',
  },
  mediaImg: { width: '100%', height: '100%' },
  videoPlaceholder: { backgroundColor: '#1E293B' },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  mediaPending: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  fileRow: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 200, paddingVertical: 2 },
  fileIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  flexShrink: { flexShrink: 1, flex: 1 },
  fileName: { fontSize: 14, fontWeight: '600' },
  fileMeta: { fontSize: 11, marginTop: 1 },
  locWrap: { flexDirection: 'row', gap: 10, minWidth: 210, paddingVertical: 2 },
  locMap: { width: 54, height: 54, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  locText: { flex: 1, justifyContent: 'center' },
  locOpen: { fontSize: 12, fontWeight: '700', marginTop: 3 },
  reaction: {
    position: 'absolute',
    bottom: -11,
    right: 8,
    borderWidth: 1,
    borderRadius: 11,
    paddingHorizontal: 5,
    paddingVertical: 1,
  },
  failedHint: { fontSize: 11, marginTop: 3, marginRight: 4 },
});
