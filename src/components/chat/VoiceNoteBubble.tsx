/**
 * Lecteur inline pour une note vocale reçue/envoyée.
 *
 * Un seul lecteur natif partagé (module-level) : lancer une note stoppe la
 * précédente. Chaque bulle s'abonne à l'état courant et n'affiche la
 * progression que si elle est la note active.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { useCachedMedia } from '@/hooks/useCachedMedia';
import { messageService } from '@/services';
import { mediaUrl } from '@/utils/media';

const player = new AudioRecorderPlayer();

type State = { url: string | null; position: number; duration: number; playing: boolean };
let state: State = { url: null, position: 0, duration: 0, playing: false };
const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

async function stopShared(): Promise<void> {
  try {
    player.removePlayBackListener();
    await player.stopPlayer();
  } catch {
    /* déjà stoppé */
  }
  state = { url: null, position: 0, duration: 0, playing: false };
  emit();
}

async function toggleShared(url: string): Promise<void> {
  if (state.url === url && state.playing) {
    try {
      await player.pausePlayer();
    } catch {
      /* noop */
    }
    state = { ...state, playing: false };
    emit();
    return;
  }
  if (state.url === url && !state.playing) {
    try {
      await player.resumePlayer();
      state = { ...state, playing: true };
      emit();
      return;
    } catch {
      /* on relance depuis le début ci-dessous */
    }
  }
  await stopShared();
  try {
    await player.startPlayer(url);
    state = { url, position: 0, duration: 0, playing: true };
    emit();
    player.addPlayBackListener((e) => {
      state = {
        url,
        position: e.currentPosition,
        duration: e.duration,
        playing: !e.isFinished,
      };
      if (e.isFinished) {
        player.removePlayBackListener();
        state = { url: null, position: 0, duration: 0, playing: false };
      }
      emit();
    });
  } catch {
    await stopShared();
  }
}

function fmt(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

interface Props {
  url: string | null | undefined;
  durationSec?: number | null;
  sizeBytes?: number | null;
  mine: boolean;
  fg: string;
  /** id du message — si fourni + reçu, on notifie « écouté » au 1er play. */
  messageId?: string;
}

function humanSize(bytes: number | null | undefined): string {
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

export const VoiceNoteBubble: React.FC<Props> = ({
  url,
  durationSec,
  sizeBytes,
  mine,
  fg,
  messageId,
}) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const [, force] = useState(0);
  const mounted = useRef(true);

  // le vocal ne se télécharge qu'au tap (comme WhatsApp) ; une fois local il
  // reste jouable hors-ligne.
  const cached = useCachedMedia(url);
  // ce qu'on donne au lecteur : le fichier local si dispo, sinon l'URL distante
  const resolved = cached.localUri ?? mediaUrl(url) ?? null;

  useEffect(() => {
    mounted.current = true;
    const fn = () => mounted.current && force((n) => n + 1);
    subs.add(fn);
    return () => {
      mounted.current = false;
      subs.delete(fn);
    };
  }, []);

  const active = !!resolved && state.url === resolved;
  const playing = active && state.playing;
  const progress =
    active && state.duration > 0 ? Math.min(1, state.position / state.duration) : 0;
  const totalMs =
    active && state.duration > 0
      ? state.duration
      : durationSec != null
        ? durationSec * 1000
        : 0;
  const label = active && state.position > 0 ? fmt(state.position) : fmt(totalMs);

  const onPress = useCallback(async () => {
    // pas encore en local -> on télécharge d'abord, puis on joue
    let playUri = cached.localUri;
    if (!playUri) {
      playUri = await cached.download();
      if (!playUri) return;
    }
    // vocal reçu -> notifie « écouté » à l'expéditeur (écran Infos)
    if (!mine && messageId) messageService.markPlayed(messageId);
    void toggleShared(playUri);
  }, [cached, mine, messageId]);

  const barActive = mine ? '#ffffff' : c.primary;
  const barIdle = mine ? 'rgba(255,255,255,0.38)' : c.border;
  const needsDownload = !cached.localUri && !!url;
  const shownProgress = cached.downloading ? cached.progress : progress;

  const iconName = cached.downloading
    ? 'progress-download'
    : needsDownload
      ? 'download'
      : playing
        ? 'pause'
        : 'play';

  const sub = cached.downloading
    ? `${Math.round(cached.progress * 100)} %`
    : needsDownload
      ? [humanSize(sizeBytes), fmt(totalMs)].filter(Boolean).join(' · ') || label
      : label;

  return (
    <Pressable onPress={onPress} style={styles.row} disabled={cached.downloading}>
      <View
        style={[
          styles.playBtn,
          { backgroundColor: mine ? 'rgba(255,255,255,0.22)' : c.primary + '1F' },
        ]}
      >
        <Icon name={iconName} size={20} color={mine ? '#fff' : c.primary} />
      </View>

      <View style={styles.waveArea}>
        <View style={styles.waveRow}>
          {WAVE.map((h, i) => {
            const filled = i / WAVE.length <= shownProgress;
            return (
              <View
                key={i}
                style={[
                  styles.bar,
                  { height: 4 + h * 16, backgroundColor: filled ? barActive : barIdle },
                ]}
              />
            );
          })}
        </View>
        <View style={styles.metaRow}>
          <Text style={[styles.time, { color: fg, opacity: 0.85 }]}>{sub}</Text>
          {/* petit badge micro (façon WhatsApp), bleu si déjà écouté par moi */}
          <Icon
            name="microphone"
            size={14}
            color={mine ? 'rgba(255,255,255,0.85)' : c.primary}
          />
        </View>
      </View>
    </Pressable>
  );
};

// hauteurs relatives (0..1) d'une "waveform" décorative fixe
const WAVE = [
  0.25, 0.55, 0.35, 0.8, 0.5, 0.95, 0.4, 0.7, 0.3, 0.6, 0.9, 0.45, 0.75, 0.35, 1, 0.5,
  0.65, 0.3, 0.85, 0.4, 0.7, 0.55, 0.35, 0.6, 0.25, 0.8, 0.45, 0.3,
];

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 210, paddingVertical: 4 },
  playBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  waveArea: { flex: 1, gap: 5 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 22 },
  bar: { width: 2.5, borderRadius: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  time: { fontSize: 11.5, fontVariant: ['tabular-nums'] },
});
