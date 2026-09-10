/**
 * Tonalité de retour d'appel (côté APPELANT) — le « koun koun koun » qu'on
 * entend pendant que ça sonne chez l'autre.
 *
 *  - destinataire EN LIGNE  -> `ringback.mp3` (tonalité téléphonique douce)
 *  - destinataire HORS LIGNE -> `ringback_offline.mp3` (bips « indisponible »)
 *
 * Joue en boucle tant que `phase === 'outgoing'` ; s'arrête dès que l'appel
 * est décroché (`connecting`/`active`), refusé, ou au timeout de sonnerie.
 * Lecture via `react-native-video` en audio seul (déjà dans le build, gère
 * `require()` + `repeat` proprement).
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import Video from 'react-native-video';

import { useCall } from '@/context/CallContext';

const RING_ONLINE = require('@/assets/sounds/ringback.mp3');
const RING_OFFLINE = require('@/assets/sounds/ringback_offline.mp3');

export const OutgoingRingback: React.FC = () => {
  const { phase, calleeOnline } = useCall();

  // uniquement pendant que « ça sonne » chez le correspondant
  if (phase !== 'outgoing') return null;

  return (
    <View style={styles.hidden} pointerEvents="none">
      <Video
        source={calleeOnline ? RING_ONLINE : RING_OFFLINE}
        repeat
        paused={false}
        playInBackground
        playWhenInactive
        ignoreSilentSwitch="ignore"
        volume={1.0}
        onError={() => undefined}
        style={styles.video}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  hidden: { position: 'absolute', width: 0, height: 0, opacity: 0 },
  video: { width: 0, height: 0 },
});
