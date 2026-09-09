/**
 * Écran d'appel actif — plein écran (phases 'outgoing', 'connecting', 'active',
 * 'ended'). Affiché par le RootNavigator.
 *
 * Vidéo : rendu via <RoomContext.Provider> + hooks LiveKit. Audio : géré par
 * la Room + AudioSession (voir CallContext). Contrôles : muet, caméra on/off,
 * bascule voix<->vidéo, haut-parleur, changement de caméra, messagerie en
 * cours d'appel, raccrocher.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import {
  RoomContext,
  VideoTrack,
  useLocalParticipant,
  useRemoteParticipants,
  useTracks,
} from '@livekit/react-native';
import { Track } from 'livekit-client';

import { Avatar, Icon } from '@/components/common';
import { formatCallDuration, useCall } from '@/context/CallContext';

import { InCallChat } from './InCallChat';

const RoundBtn: React.FC<{
  icon: string;
  label?: string;
  active?: boolean;
  danger?: boolean;
  onPress: () => void;
}> = ({ icon, label, active, danger, onPress }) => (
  <View style={styles.ctrlCol}>
    <Pressable
      onPress={onPress}
      android_ripple={{ color: '#ffffff30', borderless: true }}
      style={[
        styles.ctrlBtn,
        active && styles.ctrlBtnActive,
        danger && styles.ctrlBtnDanger,
      ]}
    >
      <Icon name={icon} size={24} color={active && !danger ? '#0B1220' : '#fff'} />
    </Pressable>
    {label ? <Text style={styles.ctrlLabel}>{label}</Text> : null}
  </View>
);

/** Rendu interne — a besoin du RoomContext pour les hooks. */
const CallStage: React.FC = () => {
  const {
    call,
    phase,
    elapsed,
    muted,
    speaker,
    cameraEnabled,
    hangUp,
    toggleMute,
    toggleSpeaker,
    toggleCamera,
    switchCamera,
    setVideo,
  } = useCall();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [chatOpen, setChatOpen] = useState(false);

  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

  if (!call) return null;

  const name = call.peer?.display_name || call.peer?.username || t('calls.unknown');
  const isVideo = call.callType === 'video';
  const peerConnected = remotes.length > 0;

  const remoteVideo = tracks.find(
    (tr) => tr.participant.identity !== localParticipant.identity && tr.publication?.isSubscribed,
  );
  const localVideo = tracks.find((tr) => tr.participant.identity === localParticipant.identity);

  const statusText =
    phase === 'outgoing'
      ? t('calls.ringing')
      : phase === 'connecting'
        ? t('calls.connecting')
        : phase === 'ended'
          ? t('calls.ended')
          : peerConnected
            ? formatCallDuration(elapsed)
            : t('calls.waitingPeer');

  const showRemoteVideo = isVideo && phase === 'active' && !!remoteVideo;

  return (
    <View style={[styles.root, { backgroundColor: '#0B1220' }]}>
      {/* fond vidéo distante (plein écran) */}
      {showRemoteVideo ? (
        <VideoTrack trackRef={remoteVideo} style={styles.fill} objectFit="cover" />
      ) : null}

      {/* infos correspondant (voix, ou vidéo pas encore là) */}
      {!showRemoteVideo ? (
        <View style={[styles.centerInfo, { paddingTop: insets.top + 56 }]}>
          <Avatar uri={call.peer?.avatar_url} name={name} size={116} />
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.status}>{statusText}</Text>
          <Text style={styles.e2ee}>
            <Icon name="lock" size={12} color="#8FA6C8" /> {t('calls.e2eeNotice')}
          </Text>
        </View>
      ) : (
        <View style={[styles.topBar, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.topName} numberOfLines={1}>{name}</Text>
          <Text style={styles.topStatus}>{statusText}</Text>
        </View>
      )}

      {/* vignette vidéo locale */}
      {isVideo && cameraEnabled && localVideo ? (
        <Pressable
          onPress={() => void switchCamera()}
          style={[styles.pip, { top: insets.top + 16 }]}
        >
          <VideoTrack trackRef={localVideo} style={styles.fill} mirror objectFit="cover" />
        </Pressable>
      ) : null}

      {/* barre de contrôles */}
      {!chatOpen ? (
        <View style={[styles.controls, { paddingBottom: insets.bottom + 22 }]}>
          <View style={styles.ctrlRow}>
            <RoundBtn
              icon={muted ? 'microphone-off' : 'microphone'}
              label={t('calls.mute')}
              active={muted}
              onPress={() => void toggleMute()}
            />
            {/* bascule voix <-> vidéo à chaud */}
            <RoundBtn
              icon={isVideo ? 'video' : 'video-plus'}
              label={isVideo ? t('calls.switchToVoice') : t('calls.switchToVideo')}
              active={false}
              onPress={() => void setVideo(!isVideo)}
            />
            {isVideo ? (
              <RoundBtn
                icon={cameraEnabled ? 'camera' : 'camera-off'}
                label={t('calls.camera')}
                active={!cameraEnabled}
                onPress={() => void toggleCamera()}
              />
            ) : null}
            <RoundBtn
              icon={speaker ? 'volume-high' : 'volume-medium'}
              label={t('calls.speaker')}
              active={speaker}
              onPress={() => void toggleSpeaker()}
            />
            <RoundBtn
              icon="message-text"
              label={t('calls.chat')}
              active={false}
              onPress={() => setChatOpen(true)}
            />
          </View>
          <View style={styles.hangupRow}>
            <RoundBtn icon="phone-hangup" danger onPress={() => void hangUp()} />
          </View>
        </View>
      ) : null}

      {/* voile sombre sur la vidéo pour lisibilité des contrôles */}
      {showRemoteVideo && !chatOpen ? <View pointerEvents="none" style={styles.scrim} /> : null}

      {/* messagerie pendant l'appel */}
      {chatOpen && call.peer ? (
        <InCallChat
          partnerId={call.peer.id}
          partnerName={name}
          onClose={() => setChatOpen(false)}
        />
      ) : null}
    </View>
  );
};

export const ActiveCallScreen: React.FC = () => {
  const { room } = useCall();
  if (!room) {
    return <View style={[styles.root, { backgroundColor: '#0B1220' }]} />;
  }
  return (
    <RoomContext.Provider value={room}>
      <CallStage />
    </RoomContext.Provider>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  centerInfo: { flex: 1, alignItems: 'center', gap: 12 },
  name: { color: '#fff', fontSize: 26, fontWeight: '800', marginTop: 10, maxWidth: 300, textAlign: 'center' },
  status: { color: '#9DB0CE', fontSize: 16, fontWeight: '600' },
  e2ee: { color: '#8FA6C8', fontSize: 12, marginTop: 4 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, alignItems: 'center', gap: 2 },
  topName: { color: '#fff', fontSize: 18, fontWeight: '800' },
  topStatus: { color: '#cdd8ec', fontSize: 13, fontWeight: '600' },
  pip: {
    position: 'absolute',
    right: 16,
    width: 104,
    height: 152,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#1A2436',
    borderWidth: 1,
    borderColor: '#ffffff22',
  },
  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 18 },
  ctrlRow: {
    flexDirection: 'row',
    gap: 18,
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    justifyContent: 'center',
    paddingHorizontal: 12,
  },
  hangupRow: { marginTop: 2 },
  ctrlCol: { alignItems: 'center', gap: 6, width: 62 },
  ctrlBtn: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#ffffff1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnActive: { backgroundColor: '#fff' },
  ctrlBtnDanger: { backgroundColor: '#E5484D', width: 64, height: 64, borderRadius: 32 },
  ctrlLabel: { color: '#cdd8ec', fontSize: 10, fontWeight: '600', textAlign: 'center' },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 220,
    backgroundColor: '#0B1220AA',
  },
});
