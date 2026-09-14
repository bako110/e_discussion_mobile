/**
 * Diffusion en direct d'une chaîne — plein écran.
 *
 * Deux rôles possibles sur le MÊME écran :
 *  - spectateur (le cas courant) : rejoint en LECTURE SEULE via
 *    `channelLiveService.join()` — ne peut jamais publier de flux, le
 *    serveur le garantit déjà côté token (voir livekit_service.build_access_token).
 *  - diffuseur (`asBroadcaster`, admin qui vient de démarrer) : publie sa
 *    caméra/micro via `channelLiveService.start()`.
 *
 * Room LiveKit dédiée, indépendante de `CallContext` (pas d'E2EE, pas de
 * sonnerie — un live n'est pas un appel 1-1).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RoomContext,
  VideoTrack,
  registerGlobals,
  useLocalParticipant,
  useTracks,
} from '@livekit/react-native';
import { Room, RoomEvent, Track } from 'livekit-client';

import { ApiError } from '@/api';
import { Avatar, Icon, confirmAlert, showAlert, showToast } from '@/components/common';
import type { MainScreenProps } from '@/navigation/types';
import { channelLiveService } from '@/services';
import type { ChannelLive } from '@/types';

// LiveKit exige registerGlobals() une seule fois, avant toute Room — CallContext
// le fait déjà au démarrage de l'app, mais cet écran doit rester autonome
// (accessible même si CallContext n'a jamais créé de Room).
let _globalsReady = false;
function ensureGlobals(): void {
  if (_globalsReady) return;
  registerGlobals();
  _globalsReady = true;
}

const BG = '#0A1020';

const LiveStage: React.FC<{
  isBroadcaster: boolean;
  channelLive: ChannelLive;
}> = ({ isBroadcaster, channelLive }) => {
  const { t } = useTranslation();
  const { localParticipant } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

  const remoteVideo = tracks.find((tr) => tr.participant.identity !== localParticipant.identity);
  const localVideo = tracks.find((tr) => tr.participant.identity === localParticipant.identity);
  const shownVideo = isBroadcaster ? localVideo : remoteVideo;

  return (
    <View style={styles.stage}>
      {shownVideo ? (
        <VideoTrack trackRef={shownVideo} style={styles.fill} objectFit="cover" mirror={isBroadcaster} />
      ) : (
        <View style={[styles.fill, styles.waitingBox]}>
          <Avatar uri={channelLive.channel_avatar_url} name={channelLive.channel_name ?? '?'} size={72} />
          <Text style={styles.waitingTxt}>
            {isBroadcaster ? t('channelLive.startingCamera') : t('channelLive.waitingVideo')}
          </Text>
        </View>
      )}
    </View>
  );
};

export const ChannelLiveViewerScreen: React.FC<MainScreenProps<'ChannelLiveViewer'>> = ({
  route,
  navigation,
}) => {
  const { groupId, asBroadcaster } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [room, setRoom] = useState<Room | null>(null);
  const [channelLive, setChannelLive] = useState<ChannelLive | null>(null);
  const [connecting, setConnecting] = useState(true);
  const [muted, setMuted] = useState(false);
  const [cameraOn, setCameraOn] = useState(true);
  const roomRef = useRef<Room | null>(null);
  const alive = useRef(true);

  const teardown = useCallback(async () => {
    const r = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    if (r) {
      try {
        await r.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      await AudioSession.stopAudioSession();
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    ensureGlobals();

    (async () => {
      try {
        await AudioSession.configureAudio({
          android: {
            preferredOutputList: ['speaker'],
            audioTypeOptions: AndroidAudioTypePresets.media,
          },
          ios: { defaultOutput: 'speaker' },
        });
        await AudioSession.startAudioSession();

        const access = asBroadcaster
          ? await channelLiveService.start(groupId)
          : await channelLiveService.join(groupId);
        if (!alive.current) return;

        const live = asBroadcaster
          ? (access as Awaited<ReturnType<typeof channelLiveService.start>>)
          : (access as Awaited<ReturnType<typeof channelLiveService.join>>).channel_live;
        setChannelLive(live);

        const r = new Room({
          adaptiveStream: true,
          dynacast: true,
        });
        r.on(RoomEvent.Disconnected, () => {
          if (alive.current) navigation.goBack();
        });
        roomRef.current = r;
        setRoom(r);
        await r.connect(access.livekit_url, access.token, { autoSubscribe: true });
        if (!alive.current) {
          await r.disconnect();
          return;
        }
        if (asBroadcaster) {
          await r.localParticipant.setCameraEnabled(true);
          await r.localParticipant.setMicrophoneEnabled(true);
        }
        setConnecting(false);
      } catch (e) {
        if (!alive.current) return;
        console.warn('[channelLive] connexion échouée:', e);
        showAlert(
          e instanceof ApiError && e.status === 409
            ? t('channelLive.alreadyLive')
            : t('errors.generic'),
        );
        navigation.goBack();
      }
    })();

    return () => {
      alive.current = false;
      void teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [groupId, asBroadcaster]);

  // Rafraîchit périodiquement le nombre de spectateurs courants — LiveKit
  // ne pousse pas cette info en temps réel, on la ré-interroge simplement
  // (léger : un GET par intervalle, uniquement pendant que cet écran est
  // ouvert) le temps que le live tourne.
  useEffect(() => {
    if (connecting) return;
    const id = setInterval(() => {
      channelLiveService
        .getForChannel(groupId)
        .then((live) => {
          if (alive.current && live) setChannelLive(live);
        })
        .catch(() => undefined);
    }, 8000);
    return () => clearInterval(id);
  }, [groupId, connecting]);

  const toggleMute = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !muted;
    await r.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !cameraOn;
    await r.localParticipant.setCameraEnabled(next);
    setCameraOn(next);
  }, [cameraOn]);

  const close = useCallback(() => {
    if (!asBroadcaster) {
      navigation.goBack();
      return;
    }
    confirmAlert(
      t('channelLive.stopTitle'),
      t('channelLive.stopBody'),
      () => {
        void channelLiveService
          .stop(groupId)
          .then(() => showToast(t('channelLive.stopped')))
          .catch(() => undefined);
        navigation.goBack();
      },
      { destructive: true, confirmText: t('channelLive.stopConfirm'), cancelText: t('common.cancel') },
    );
  }, [asBroadcaster, groupId, navigation, t]);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {room ? (
        <RoomContext.Provider value={room}>
          {channelLive ? <LiveStage isBroadcaster={!!asBroadcaster} channelLive={channelLive} /> : null}
        </RoomContext.Provider>
      ) : (
        <View style={[styles.fill, styles.center]}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      {connecting ? (
        <View style={[styles.fill, styles.center, styles.connectingOverlay]} pointerEvents="none">
          <ActivityIndicator color="#fff" size="large" />
          <Text style={styles.connectingTxt}>{t('channelLive.connecting')}</Text>
        </View>
      ) : null}

      {/* en-tête : nom de la chaîne + badge LIVE + bouton fermer */}
      <View style={styles.topBar}>
        <View style={styles.liveBadge}>
          <View style={styles.liveDot} />
          <Text style={styles.liveTxt}>{t('channelLive.live')}</Text>
        </View>
        <Text style={styles.channelName} numberOfLines={1}>
          {channelLive?.channel_name ?? ''}
        </Text>
        {channelLive && channelLive.current_viewers > 0 ? (
          <View style={styles.viewersBadge}>
            <Icon name="eye" size={13} color="#fff" />
            <Text style={styles.viewersTxt}>{channelLive.current_viewers}</Text>
          </View>
        ) : null}
        <Pressable onPress={close} hitSlop={12} style={styles.closeBtn}>
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </View>

      {/* contrôles diffuseur (micro / caméra) */}
      {asBroadcaster ? (
        <View style={[styles.controls, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable
            onPress={() => void toggleMute()}
            style={[styles.ctrlBtn, muted && { backgroundColor: '#fff' }]}
          >
            <Icon name={muted ? 'microphone-off' : 'microphone'} size={22} color={muted ? BG : '#fff'} />
          </Pressable>
          <Pressable
            onPress={() => void toggleCamera()}
            style={[styles.ctrlBtn, !cameraOn && { backgroundColor: '#fff' }]}
          >
            <Icon name={cameraOn ? 'video' : 'video-off'} size={22} color={!cameraOn ? BG : '#fff'} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  fill: { flex: 1 },
  stage: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center' },
  connectingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(10,16,32,0.7)' },
  connectingTxt: { color: '#fff', marginTop: 12, fontSize: 14, fontWeight: '600' },
  waitingBox: { alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: '#12203C' },
  waitingTxt: { color: '#ffffffcc', fontSize: 14 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 10,
    gap: 10,
  },
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: '#E0203D',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#fff' },
  liveTxt: { color: '#fff', fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },
  viewersBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.4)',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  viewersTxt: { color: '#fff', fontSize: 12, fontWeight: '700' },
  channelName: { flex: 1, color: '#fff', fontSize: 15, fontWeight: '700' },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  controls: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 18,
  },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
});
