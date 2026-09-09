import React from 'react';
import { ActivityIndicator, Image, StyleSheet, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';

const MARK = require('@/assets/logo_mark.png');

/** Continuite visuelle avec le splash natif : meme logo centre, pendant que
 * la session se recharge (AuthContext status === 'loading'). */
export const SplashView: React.FC = () => {
  const { theme } = useTheme();
  return (
    <View style={[styles.wrap, { backgroundColor: '#FFFFFF' }]}>
      <Image source={MARK} style={styles.mark} resizeMode="contain" />
      <ActivityIndicator color={theme.colors.primary} style={styles.spinner} />
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  mark: { width: 140, height: 140 },
  spinner: { position: 'absolute', bottom: 72 },
});
