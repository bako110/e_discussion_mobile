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

export const VoiceNoteBubble: React.FC<Props> = ({ url, durationSec, sizeBytes, mine, fg }) => {
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
    void toggleShared(playUri);
  }, [cached]);

  const track = mine ? 'rgba(255,255,255,0.35)' : c.border;
  const fill = mine ? '#fff' : c.primary;
  const needsDownload = !cached.localUri && !!url;
  const sub = cached.downloading
    ? `${Math.round(cached.progress * 100)} %`
    : needsDownload
      ? [humanSize(sizeBytes), fmt(totalMs)].filter(Boolean).join(' · ') || label
      : label;

  return (
    <Pressable onPress={onPress} style={styles.row} disabled={cached.downloading}>
      <View style={[styles.playBtn, { backgroundColor: mine ? 'rgba(255,255,255,0.2)' : c.primary + '22' }]}>
        <Icon
          name={cached.downloading ? 'progress-download' : needsDownload ? 'download' : playing ? 'pause' : 'play'}
          size={18}
          color={fg}
        />
      </View>
      <View style={styles.waveArea}>
        <View style={[styles.track, { backgroundColor: track }]}>
          <View
            style={[
              styles.fill,
              {
                backgroundColor: fill,
                width: `${(cached.downloading ? cached.progress : progress) * 100}%`,
              },
            ]}
          />
        </View>
        <Text style={[styles.time, { color: fg, opacity: 0.75 }]}>{sub}</Text>
      </View>
      <View style={{ opacity: 0.6 }}>
        <Icon name="microphone" size={15} color={fg} />
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minWidth: 180, paddingVertical: 2 },
  playBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  waveArea: { flex: 1, gap: 4 },
  track: { height: 4, borderRadius: 2, overflow: 'hidden' },
  fill: { height: 4, borderRadius: 2 },
  time: { fontSize: 11 },
});
