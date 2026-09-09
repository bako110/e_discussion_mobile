/**
 * Écran d'appel entrant (récepteur) — plein écran dès qu'un event WS
 * `call.incoming` arrive (phase 'incoming'). Design aligné sur ActiveCallScreen.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Avatar, Icon } from '@/components/common';
import { useCall } from '@/context/CallContext';

const BG = '#0A1020';
const ACCEPT = '#27C46B';
const DECLINE = '#F5484D';

export const IncomingCallScreen: React.FC = () => {
  const { call, acceptCall, rejectCall, phase } = useCall();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  // pouls de l'anneau autour de l'avatar (sonnerie)
  const ring = useRef(new Animated.Value(0)).current;
  // léger va-et-vient vertical du bouton « Répondre »
  const bob = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: 260,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();

    const ringLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring, { toValue: 1, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    const bobLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 700, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    ringLoop.start();
    bobLoop.start();
    return () => {
      ringLoop.stop();
      bobLoop.stop();
    };
  }, [ring, bob, enter]);

  if (!call) return null;
  const name = call.peer?.display_name || call.peer?.username || t('calls.unknown');
  const isVideo = call.callType === 'video';
  const connecting = phase === 'connecting';

  const ringScale = ring.interpolate({ inputRange: [0, 1], outputRange: [1, 1.9] });
  const ringOpacity = ring.interpolate({ inputRange: [0, 0.15, 1], outputRange: [0, 0.35, 0] });
  const bobY = bob.interpolate({ inputRange: [0, 1], outputRange: [0, -8] });

  return (
    <View style={[styles.root, { backgroundColor: BG }]}>
      {/* fond dégradé simulé */}
      <View style={[styles.grad, { backgroundColor: '#12203C', opacity: 0.9 }]} />
      <View style={[styles.gradTop, { backgroundColor: '#1B2E52' }]} />

      <Animated.View
        style={[
          styles.top,
          {
            paddingTop: insets.top + 54,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
          },
        ]}
      >
        <View style={styles.kindRow}>
          <Icon name={isVideo ? 'video' : 'phone-incoming'} size={15} color="#8FA6C8" />
          <Text style={styles.kind}>
            {isVideo ? t('calls.incomingVideo') : t('calls.incomingVoice')}
          </Text>
        </View>

        <View style={styles.avatarWrap}>
          {/* anneaux qui pulsent */}
          <Animated.View
            style={[
              styles.pulseRing,
              { transform: [{ scale: ringScale }], opacity: ringOpacity },
            ]}
          />
          <View style={styles.avatarHalo}>
            <Avatar uri={call.peer?.avatar_url} name={name} size={138} />
          </View>
        </View>

        <Text style={styles.name} numberOfLines={1}>{name}</Text>
        <View style={styles.e2eeRow}>
          <Icon name="lock" size={12} color="#8FA6C8" />
          <Text style={styles.e2ee}>{t('calls.e2eeNotice')}</Text>
        </View>
      </Animated.View>

      <Animated.View
        style={[
          styles.actions,
          {
            paddingBottom: insets.bottom + 44,
            opacity: enter,
            transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
          },
        ]}
      >
        {/* Refuser */}
        <View style={styles.actionCol}>
          <Pressable
            style={[styles.btn, { backgroundColor: DECLINE }]}
            onPress={() => void rejectCall()}
            android_ripple={{ color: '#ffffff40', borderless: true, radius: 40 }}
          >
            <Icon name="phone-hangup" size={30} color="#fff" />
          </Pressable>
          <Text style={styles.actionLabel}>{t('calls.decline')}</Text>
        </View>

        {/* Répondre en audio (seulement si l'appel entrant est vidéo) */}
        {isVideo && !connecting ? (
          <View style={styles.actionCol}>
            <Pressable
              style={[styles.btn, styles.btnSmall, { backgroundColor: 'rgba(255,255,255,0.14)' }]}
              onPress={() => void acceptCall({ asAudio: true })}
              android_ripple={{ color: '#ffffff40', borderless: true, radius: 34 }}
            >
              <Icon name="phone" size={24} color="#fff" />
            </Pressable>
            <Text style={styles.actionLabel}>{t('calls.answerAudio')}</Text>
          </View>
        ) : null}

        {/* Répondre */}
        <Animated.View style={[styles.actionCol, { transform: [{ translateY: connecting ? 0 : bobY }] }]}>
          <Pressable
            style={[styles.btn, { backgroundColor: ACCEPT, opacity: connecting ? 0.55 : 1 }]}
            disabled={connecting}
            onPress={() => void acceptCall()}
            android_ripple={{ color: '#ffffff40', borderless: true, radius: 40 }}
          >
            <Icon name={connecting ? 'phone-in-talk' : isVideo ? 'video' : 'phone'} size={30} color="#fff" />
          </Pressable>
          <Text style={styles.actionLabel}>
            {connecting ? t('calls.connecting') : t('calls.accept')}
          </Text>
        </Animated.View>
      </Animated.View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden' },
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

  top: { alignItems: 'center', gap: 14 },
  kindRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  kind: { color: '#8FA6C8', fontSize: 14.5, fontWeight: '700', letterSpacing: 0.3 },

  avatarWrap: { marginTop: 10, alignItems: 'center', justifyContent: 'center' },
  pulseRing: {
    position: 'absolute',
    width: 150,
    height: 150,
    borderRadius: 75,
    borderWidth: 2,
    borderColor: ACCEPT,
  },
  avatarHalo: {
    padding: 6,
    borderRadius: 84,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },

  name: { color: '#fff', fontSize: 29, fontWeight: '800', maxWidth: 320, textAlign: 'center', letterSpacing: -0.4, marginTop: 6 },
  e2eeRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  e2ee: { color: '#8FA6C8', fontSize: 12, fontWeight: '600' },

  actions: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center', gap: 40 },
  actionCol: { alignItems: 'center', gap: 10, width: 92 },
  btn: { width: 70, height: 70, borderRadius: 35, alignItems: 'center', justifyContent: 'center' },
  btnSmall: { width: 58, height: 58, borderRadius: 29 },
  actionLabel: { color: '#cdd8ec', fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
