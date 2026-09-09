/**
 * Overlay plein écran affiché au-dessus de toute la navigation quand un appel
 * est en cours (entrant, sortant ou actif). Monté par le RootNavigator.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';

import { useCall } from '@/context/CallContext';

import { ActiveCallScreen } from './ActiveCallScreen';
import { IncomingCallScreen } from './IncomingCallScreen';

export const CallOverlay: React.FC = () => {
  const { phase } = useCall();

  if (phase === 'idle') return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View style={StyleSheet.absoluteFill}>
        {phase === 'incoming' ? <IncomingCallScreen /> : <ActiveCallScreen />}
      </View>
    </View>
  );
};
