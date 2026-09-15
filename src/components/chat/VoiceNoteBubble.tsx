/**
 * Lecteur inline pour une note vocale reçue/envoyée.
 *
 * Le lecteur natif est un SINGLETON partagé (`@/services/voicePlayer`) : la
 * lecture continue même si on quitte le chat, et un mini-lecteur global la
 * pilote depuis n'importe où. Chaque bulle s'abonne à l'état courant et
 * n'affiche la progression que si elle est la note active.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { Avatar, Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { useCachedMedia } from '@/hooks/useCachedMedia';
import { messageService } from '@/services';
import {
  getVoiceState,
  seekVoice,
  subscribeVoice,
  toggleVoice,
  type PlayMeta,
} from '@/services/voicePlayer';
import { mediaUrl } from '@/utils/media';
import { clockTime } from '@/utils/time';

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
  /** `false` -> point bleu « pas encore écouté » (vocal reçu). */
  played?: boolean;
  /** appelé au 1er play d'un vocal reçu (persistance locale + refresh). */
  onFirstPlay?: () => void;
  /** contexte pour le mini-lecteur global (conversation + titre affiché). */
  playerMeta?: PlayMeta;
  /** menu contextuel (répondre/copier/supprimer) — appliqué ICI (même
   * Pressable que le tap play) plutôt que sur un parent englobant, pour
   * éviter la compétition de gestes entre deux Pressable imbriqués. */
  onLongPress?: () => void;
  /** Photo de l'expéditeur, façon WhatsApp — affichée pour un vocal REÇU
   * (`!mine`) ou ENVOYÉ (`mine`, ma propre photo) : WhatsApp affiche
   * l'avatar dans les deux sens, jamais seulement d'un côté. */
  senderAvatar?: string | null;
  senderName?: string | null;
  /** Statut d'accusé de réception — coche façon WhatsApp, affichée SEULEMENT
   * pour un vocal ENVOYÉ (`mine`) : je ne vois jamais d'accusé sur ce que je
   * reçois. `undefined` masque la coche (ex: contexte sans suivi d'état). */
  deliveryStatus?: 'pending' | 'sent' | 'delivered' | 'read' | 'failed';
  /** Horodatage du message (ISO) — affiché à la place de la taille/durée une
   * fois le vocal téléchargé, façon WhatsApp (la taille ne sert que tant que
   * le fichier n'est pas encore récupéré). */
  createdAt?: string;
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
  played = true,
  onFirstPlay,
  playerMeta,
  onLongPress,
  senderAvatar,
  senderName,
  deliveryStatus,
  createdAt,
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
    const off = subscribeVoice(() => mounted.current && force((n) => n + 1));
    return () => {
      mounted.current = false;
      off();
    };
  }, []);

  const vp = getVoiceState();
  const active = !!resolved && vp.url === resolved;
  const playing = active && vp.playing;
  const progress =
    active && vp.duration > 0 ? Math.min(1, vp.position / vp.duration) : 0;
  const totalMs =
    active && vp.duration > 0
      ? vp.duration
      : durationSec != null
        ? durationSec * 1000
        : 0;
  const label = active && vp.position > 0 ? fmt(vp.position) : fmt(totalMs);

  const onPress = useCallback(async () => {
    // pas encore en local -> on télécharge d'abord, puis on joue
    let playUri = cached.localUri;
    if (!playUri) {
      playUri = await cached.download();
      if (!playUri) return;
    }
    // vocal reçu -> notifie « écouté » (expéditeur : écran Infos) + retire le
    // point bleu localement.
    if (!mine && messageId) {
      messageService.markPlayed(messageId);
      if (!played) onFirstPlay?.();
    }
    void toggleVoice(playUri, {
      ...playerMeta,
      durationMs:
        playerMeta?.durationMs ?? (durationSec != null ? durationSec * 1000 : null),
    });
  }, [cached, mine, messageId, played, onFirstPlay, playerMeta, durationSec]);

  // Glisser sur la waveform pour avancer/reculer dans le vocal, façon
  // WhatsApp. Seek possible seulement si la note est déjà locale (sinon un
  // tap doit d'abord télécharger, via `onPress` sur le bouton play) et déjà
  // chargée dans le lecteur (sinon on ne fait que la sélectionner).
  const waveWidth = useRef(0);
  const seekAtRatio = useCallback(
    (ratio: number) => {
      if (!resolved) return;
      const dur = active && vp.duration > 0 ? vp.duration : totalMs;
      if (!dur) return;
      const clamped = Math.max(0, Math.min(1, ratio));
      void seekVoice(resolved, clamped * dur);
    },
    [resolved, active, vp.duration, totalMs],
  );
  // `seekAtRatio` change à chaque render (dépend de vp.duration) — on la
  // garde dans un ref pour que le PanResponder, créé UNE SEULE fois, appelle
  // toujours la version à jour sans se recréer (le recréer casserait un
  // geste de glissement en cours).
  const seekAtRatioRef = useRef(seekAtRatio);
  seekAtRatioRef.current = seekAtRatio;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (waveWidth.current > 0) {
          seekAtRatioRef.current(e.nativeEvent.locationX / waveWidth.current);
        }
      },
      onPanResponderMove: (e) => {
        if (waveWidth.current > 0) {
          seekAtRatioRef.current(e.nativeEvent.locationX / waveWidth.current);
        }
      },
    }),
  ).current;

  // vocal REÇU pas encore écouté -> accent bleu vif (bulle in) façon WhatsApp
  const unheard = !mine && !played;
  const accent = unheard ? '#2E9BFF' : mine ? '#ffffff' : c.primary;
  const barActive = mine ? '#ffffff' : accent;
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

  // Une fois téléchargé, la taille ne sert plus à rien (elle n'aide qu'à
  // savoir combien on va télécharger) — seule la durée/position reste
  // affichée ici. L'heure d'envoi est affichée séparément (metaRow,
  // à droite avec la coche), jamais à la place de la durée.
  const sub = cached.downloading
    ? `${Math.round(cached.progress * 100)} %`
    : needsDownload
      ? [humanSize(sizeBytes), fmt(totalMs)].filter(Boolean).join(' · ') || label
      : label;

  return (
    <Pressable onLongPress={onLongPress} style={styles.row} disabled={cached.downloading}>
      {senderAvatar !== undefined ? (
        <Avatar uri={senderAvatar} name={senderName} size={32} />
      ) : null}

      <View style={styles.waveArea}>
        <View
          style={styles.waveRow}
          onLayout={(e) => {
            waveWidth.current = e.nativeEvent.layout.width;
          }}
          {...panResponder.panHandlers}
        >
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
          <Text style={[styles.time, { color: fg, opacity: 0.85 }]} numberOfLines={1}>
            {sub}
          </Text>
          <View style={styles.metaRight}>
            {createdAt ? (
              <Text style={[styles.time, { color: fg, opacity: 0.85 }]}>
                {clockTime(createdAt)}
              </Text>
            ) : null}
            {mine && deliveryStatus ? (
              // Vocal ENVOYÉ : coche d'accusé façon WhatsApp (jamais sur un
              // vocal reçu — on ne voit pas l'accusé de ce qu'on reçoit).
              <Icon
                name={
                  deliveryStatus === 'failed'
                    ? 'alert-circle-outline'
                    : deliveryStatus === 'pending'
                      ? 'clock-outline'
                      : deliveryStatus === 'sent'
                        ? 'check'
                        : 'check-all'
                }
                size={14}
                color={
                  deliveryStatus === 'failed'
                    ? c.danger
                    : deliveryStatus === 'read'
                      ? '#7FD0FF'
                      : 'rgba(255,255,255,0.85)'
                }
              />
            ) : !mine ? (
              // vocal REÇU : badge micro, bleu vif tant qu'il n'est pas écouté
              <Icon
                name="microphone"
                size={14}
                color={unheard ? '#2E9BFF' : c.textFaint}
              />
            ) : null}
          </View>
        </View>
      </View>

      <Pressable
        onPress={onPress}
        hitSlop={8}
        style={[
          styles.playBtn,
          {
            backgroundColor: unheard
              ? '#2E9BFF'
              : mine
                ? 'rgba(255,255,255,0.22)'
                : c.primary + '1F',
          },
        ]}
      >
        <Icon
          name={iconName}
          size={20}
          color={unheard ? '#fff' : mine ? '#fff' : c.primary}
        />
      </Pressable>
    </Pressable>
  );
};

// hauteurs relatives (0..1) d'une "waveform" décorative fixe
const WAVE = [
  0.25, 0.55, 0.35, 0.8, 0.5, 0.95, 0.4, 0.7, 0.3, 0.6, 0.9, 0.45, 0.75, 0.35, 1, 0.5,
  0.65, 0.3, 0.85, 0.4, 0.7, 0.55, 0.35, 0.6, 0.25, 0.8, 0.45, 0.3,
];

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 230, paddingVertical: 4 },
  playBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  waveArea: { flex: 1, gap: 5, minWidth: 0 },
  waveRow: { flexDirection: 'row', alignItems: 'center', gap: 2.5, height: 22 },
  bar: { width: 2.5, borderRadius: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  metaRight: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 0 },
  time: { fontSize: 11.5, fontVariant: ['tabular-nums'], flexShrink: 1 },
});
