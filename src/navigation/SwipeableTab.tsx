/**
 * Enveloppe un écran d'onglet pour permettre le changement d'onglet par
 * BALAYAGE horizontal (façon WhatsApp) en plus du tap sur la barre du bas.
 *
 * `@react-navigation/bottom-tabs` n'anime pas la transition ; l'écran bascule
 * à la fin du geste. Un swipe vers la GAUCHE va à l'onglet suivant, vers la
 * DROITE à l'onglet précédent. Le geste ne se déclenche que s'il est
 * franchement horizontal (évite d'intercepter les scrolls verticaux et les
 * swipes internes type « répondre à un message »).
 */
import React, { useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';

import type { TabParamList } from './types';

const ORDER: (keyof TabParamList)[] = [
  'ChatsTab',
  'CallsTab',
  'StatusTab',
  'GroupsTab',
  'SettingsTab',
];

const THRESHOLD = 60; // px de déplacement horizontal pour valider
const H_DOMINANCE = 1.8; // |dx| doit dominer |dy| d'au moins ce facteur

export const SwipeableTab: React.FC<{
  name: keyof TabParamList;
  children: React.ReactNode;
}> = ({ name, children }) => {
  const navigation =
    useNavigation<BottomTabNavigationProp<TabParamList>>();
  const nudge = useRef(new Animated.Value(0)).current;

  const pan = useMemo(
    () =>
      PanResponder.create({
        // ne prend le geste que s'il est clairement horizontal
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 14 && Math.abs(g.dx) > Math.abs(g.dy) * H_DOMINANCE,
        onPanResponderMove: (_e, g) => {
          // léger retour visuel : l'écran suit le doigt sur quelques px
          nudge.setValue(Math.max(-24, Math.min(24, g.dx / 4)));
        },
        onPanResponderRelease: (_e, g) => {
          Animated.spring(nudge, {
            toValue: 0,
            useNativeDriver: true,
            speed: 20,
            bounciness: 4,
          }).start();
          const i = ORDER.indexOf(name);
          if (i === -1) return;
          if (g.dx <= -THRESHOLD && i < ORDER.length - 1) {
            navigation.jumpTo(ORDER[i + 1]!);
          } else if (g.dx >= THRESHOLD && i > 0) {
            navigation.jumpTo(ORDER[i - 1]!);
          }
        },
        onPanResponderTerminate: () => {
          Animated.spring(nudge, { toValue: 0, useNativeDriver: true }).start();
        },
      }),
    [name, navigation, nudge],
  );

  return (
    <Animated.View
      style={[styles.fill, { transform: [{ translateX: nudge }] }]}
      {...pan.panHandlers}
    >
      <View style={styles.fill}>{children}</View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
