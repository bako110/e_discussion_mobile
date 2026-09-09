/**
 * Écran d'appel actif — plein écran (phases 'outgoing', 'connecting', 'active').
 * Peut être réduit (bouton chevron-down -> pilule flottante, l'appel continue).
 *
 * Vidéo : rendu via <RoomContext.Provider> + hooks LiveKit. Audio : géré par
 * la Room + AudioSession (voir CallContext).
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
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

const BG = '#0A1020';
const PANEL = 'rgba(255,255,255,0.10)';
const PANEL_ON = '#FFFFFF';
const DANGER = '#F5484D';

/** Bouton de contrôle rond, style « verre ». `on` = état actif (accent clair). */
const CtrlBtn: React.FC<{
  icon: string;
  label?: string;
  on?: boolean;
  big?: boolean;
  danger?: boolean;
  onPress: () => void;
}> = ({ icon, label, on, big, danger, onPress }) => (
  <View style={styles.ctrlCol}>
    <Pressable
      onPress={onPress}
      android_ripple={{ color: '#ffffff33', borderless: true, radius: big ? 40 : 32 }}
      style={[
        styles.ctrlBtn,
        big && styles.ctrlBtnBig,
        { backgroundColor: danger ? DANGER : on ? PANEL_ON : PANEL },
      ]}
    >
      <Icon
        name={icon}
        size={big ? 28 : 24}
        color={danger ? '#fff' : on ? BG : '#fff'}
      />
    </Pressable>
    {label ? (
      <Text style={[styles.ctrlLabel, on && !danger && styles.ctrlLabelOn]}>{label}</Text>
    ) : null}
  </View>
);

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
    minimize,
  } = useCall();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const [chatOpen, setChatOpen] = useState(false);
  const enter = useRef(new Animated.Value(0)).current;

  const { localParticipant } = useLocalParticipant();
  const remotes = useRemoteParticipants();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: true });

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [enter]);

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
    <View style={[styles.root, { backgroundColor: BG }]}>
      {/* fond vidéo distante plein écran */}
      {showRemoteVideo ? (
        <VideoTrack trackRef={remoteVideo} style={styles.fill} objectFit="cover" />
      ) : (
        // dégradé simulé (voix / vidéo pas encore là)
        <>
          <View style={[styles.grad, { backgroundColor: '#12203C', opacity: 0.9 }]} />
          <View style={[styles.gradTop, { backgroundColor: '#1B2E52' }]} />
        </>
      )}

      {/* barre haut : réduire + (nom si vidéo) */}
      <View style={[styles.topRow, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={minimize} hitSlop={12} style={styles.topBtn}>
          <Icon name="chevron-down" size={26} color="#fff" />
        </Pressable>
        {showRemoteVideo ? (
          <View style={styles.topCenter}>
            <Text style={styles.topName} numberOfLines={1}>{name}</Text>
            <Text style={styles.topStatus}>{statusText}</Text>
          </View>
        ) : (
          <View style={styles.topLock}>
            <Icon name="lock" size={12} color="#8FA6C8" />
            <Text style={styles.topLockTxt}>{t('calls.e2eeNotice')}</Text>
          </View>
        )}
        <View style={styles.topBtn} />
      </View>

      {/* infos correspondant (voix, ou vidéo pas encore là) */}
      {!showRemoteVideo ? (
        <Animated.View
          style={[
            styles.centerInfo,
            {
              opacity: enter,
              transform: [
                { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.avatarHalo}>
            <Avatar uri={call.peer?.avatar_url} name={name} size={128} />
          </View>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          <Text style={styles.status}>{statusText}</Text>
        </Animated.View>
      ) : null}

      {/* vignette vidéo locale */}
      {isVideo && cameraEnabled && localVideo ? (
        <Pressable
          onPress={() => void switchCamera()}
          style={[styles.pip, { top: insets.top + 60 }]}
        >
          <VideoTrack trackRef={localVideo} style={styles.fill} mirror objectFit="cover" />
          <View style={styles.pipFlip}>
            <Icon name="camera-flip" size={14} color="#fff" />
          </View>
        </Pressable>
      ) : null}

      {/* barre de contrôles */}
      {!chatOpen ? (
        <Animated.View
          style={[
            styles.controls,
            {
              paddingBottom: insets.bottom + 26,
              opacity: enter,
              transform: [
                { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
              ],
            },
          ]}
        >
          <View style={styles.ctrlRow}>
            <CtrlBtn
              icon={muted ? 'microphone-off' : 'microphone'}
              label={t('calls.mute')}
              on={muted}
              onPress={() => void toggleMute()}
            />
            <CtrlBtn
              icon={speaker ? 'volume-high' : 'volume-medium'}
              label={t('calls.speaker')}
              on={speaker}
              onPress={() => void toggleSpeaker()}
            />
            <CtrlBtn
              icon={isVideo ? 'video' : 'video-plus'}
              label={isVideo ? t('calls.switchToVoice') : t('calls.switchToVideo')}
              on={isVideo}
              onPress={() => void setVideo(!isVideo)}
            />
            <CtrlBtn
              icon="message-text"
              label={t('calls.chat')}
              onPress={() => setChatOpen(true)}
            />
          </View>

          <View style={styles.ctrlRow}>
            {isVideo ? (
              <CtrlBtn
                icon={cameraEnabled ? 'camera' : 'camera-off'}
                label={t('calls.camera')}
                on={!cameraEnabled}
                onPress={() => void toggleCamera()}
              />
            ) : (
              <View style={styles.ctrlCol} />
            )}
            <CtrlBtn icon="phone-hangup" big danger onPress={() => void hangUp()} />
            {isVideo ? (
              <CtrlBtn
                icon="camera-flip"
                label={t('calls.flip')}
                onPress={() => void switchCamera()}
              />
            ) : (
              <View style={styles.ctrlCol} />
            )}
          </View>
        </Animated.View>
      ) : null}

      {/* voile sombre en bas de la vidéo pour lisibilité des contrôles */}
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
    return <View style={[styles.root, { backgroundColor: BG }]} />;
  }
  return (
    <RoomContext.Provider value={room}>
      <CallStage />
    </RoomContext.Provider>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, overflow: 'hidden' },
  fill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  grad: { ...StyleSheet.absoluteFillObject },
  gradTop: {
    position: 'absolute',
    top: -160,
    left: -80,
    right: -80,
    height: 420,
    borderRadius: 300,
    opacity: 0.55,
  },

  topRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
  },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  topCenter: { flex: 1, alignItems: 'center', gap: 1 },
  topName: { color: '#fff', fontSize: 16, fontWeight: '800' },
  topStatus: { color: '#cdd8ec', fontSize: 12, fontWeight: '600' },
  topLock: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  topLockTxt: { color: '#8FA6C8', fontSize: 12, fontWeight: '600' },

  centerInfo: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 24 },
  avatarHalo: {
    padding: 6,
    borderRadius: 80,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  name: { color: '#fff', fontSize: 27, fontWeight: '800', maxWidth: 320, textAlign: 'center', letterSpacing: -0.4 },
  status: { color: '#9DB0CE', fontSize: 15.5, fontWeight: '600' },

  pip: {
    position: 'absolute',
    right: 16,
    width: 108,
    height: 156,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#1A2436',
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pipFlip: {
    position: 'absolute',
    right: 6,
    bottom: 6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  controls: { position: 'absolute', bottom: 0, left: 0, right: 0, alignItems: 'center', gap: 22, paddingHorizontal: 12 },
  ctrlRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 22 },
  ctrlCol: { alignItems: 'center', gap: 7, width: 66 },
  ctrlBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctrlBtnBig: { width: 68, height: 68, borderRadius: 34 },
  ctrlLabel: { color: '#AEBDD1', fontSize: 11, fontWeight: '600', textAlign: 'center' },
  ctrlLabelOn: { color: '#fff' },

  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 260,
    backgroundColor: 'rgba(10,16,32,0.72)',
  },
});
