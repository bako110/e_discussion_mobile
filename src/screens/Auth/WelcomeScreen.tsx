import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { useTranslation } from 'react-i18next';

import { Button, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { AuthScreenProps } from '@/navigation/types';

const MARK = require('@/assets/logo_mark_transparent.png');

const Feature: React.FC<{ icon: string; text: string }> = ({ icon, text }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.feature}>
      <View style={[styles.featureIcon, { backgroundColor: c.primary + '18' }]}>
        <Icon name={icon} size={18} color={c.primary} />
      </View>
      <Text style={[styles.featureText, { color: c.textMuted }]}>{text}</Text>
    </View>
  );
};

export const WelcomeScreen: React.FC<AuthScreenProps<'Welcome'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const fade = useRef(new Animated.Value(0)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(fade, { toValue: 1, duration: 500, useNativeDriver: true }).start();
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ]),
    ).start();
  }, [fade, float]);

  const translateY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });

  return (
    <Screen padded>
      <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <RadialGradient id="halo" cx="50%" cy="28%" r="60%">
            <Stop offset="0" stopColor={c.primary} stopOpacity={theme.isDark ? 0.2 : 0.1} />
            <Stop offset="0.6" stopColor={c.accent} stopOpacity={0.05} />
            <Stop offset="1" stopColor={c.background} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="50%" cy="26%" r="55%" fill="url(#halo)" />
      </Svg>

      <Animated.View style={[styles.hero, { opacity: fade }]}>
        <Animated.View style={[styles.markWrap, { transform: [{ translateY }] }]}>
          <Image source={MARK} style={styles.mark} resizeMode="contain" />
        </Animated.View>
        <Text style={[styles.wordmark, { color: c.text }]}>
          <Text style={{ color: c.primary }}>E</Text>-discussion
        </Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>{t('auth.heroSubtitle')}</Text>
      </Animated.View>

      <Animated.View style={[styles.features, { opacity: fade }]}>
        <Feature icon="lock-check-outline" text={t('auth.featureEncrypted')} />
        <Feature icon="cloud-off-outline" text={t('auth.featureOffline')} />
      </Animated.View>

      <Animated.View style={[styles.actions, { opacity: fade }]}>
        <Button label={t('auth.getStarted')} onPress={() => navigation.navigate('Phone')} />
      </Animated.View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  markWrap: { alignItems: 'center', justifyContent: 'center' },
  mark: { width: 150, height: 118 },
  wordmark: { fontSize: 30, fontWeight: '800', letterSpacing: -0.6, marginTop: 6 },
  subtitle: { fontSize: 15, textAlign: 'center', paddingHorizontal: 28, lineHeight: 21, marginTop: 4 },
  features: { gap: 12, paddingVertical: 8, alignItems: 'center' },
  feature: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  featureIcon: { width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  featureText: { fontSize: 13, fontWeight: '500' },
  actions: { paddingTop: 16, paddingBottom: 8 },
});
