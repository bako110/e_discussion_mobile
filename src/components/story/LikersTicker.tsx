import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/common';

const ROW_HEIGHT = 40;
const RISE_DISTANCE = 46;

/**
 * Bandeau façon « générique » : les noms de ceux qui ont liké apparaissent
 * un par un, montent puis s'effacent complètement (fade + translation vers
 * le haut) avant que le suivant n'apparaisse — jamais deux noms visibles en
 * même temps, jamais un nom qui reste figé à l'écran. Joué une seule fois
 * sur toute la liste, pas en boucle. Un appui met en pause le temps de lire ;
 * il reprend au relâchement.
 */
export const LikersTicker: React.FC<{
  names: string[];
  textColor: string;
}> = ({ names, textColor }) => {
  const [index, setIndex] = useState(0);
  const translateY = useRef(new Animated.Value(0)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const animRef = useRef<Animated.CompositeAnimation | null>(null);
  const pausedRef = useRef(false);

  const playOne = (i: number) => {
    translateY.setValue(0);
    opacity.setValue(0);
    animRef.current = Animated.sequence([
      Animated.parallel([
        Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: -RISE_DISTANCE / 2,
          duration: 900,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
      Animated.delay(650),
      Animated.parallel([
        Animated.timing(opacity, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.timing(translateY, {
          toValue: -RISE_DISTANCE,
          duration: 300,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ]);
    animRef.current.start(({ finished }) => {
      if (finished && !pausedRef.current && i + 1 < names.length) setIndex(i + 1);
    });
  };

  useEffect(() => {
    if (names.length === 0) return;
    setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [names]);

  useEffect(() => {
    if (names.length === 0) return;
    playOne(index);
    return () => animRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, names]);

  if (names.length === 0) return null;
  const name = names[index];

  return (
    <View style={[styles.ticker, { height: ROW_HEIGHT }]}>
      <Pressable
        onPressIn={() => {
          pausedRef.current = true;
          animRef.current?.stop();
        }}
        onPressOut={() => {
          pausedRef.current = false;
          playOne(index);
        }}
        style={StyleSheet.absoluteFill}
      >
        <Animated.View
          style={[styles.tickerRow, { height: ROW_HEIGHT, opacity, transform: [{ translateY }] }]}
        >
          <Icon name="heart" size={17} color="#e0245e" />
          <Text style={[styles.tickerName, { color: textColor }]} numberOfLines={1}>
            {name}
          </Text>
        </Animated.View>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  ticker: { overflow: 'hidden' },
  tickerRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  tickerName: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
});
