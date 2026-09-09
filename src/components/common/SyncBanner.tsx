import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';

import { Icon } from './Icon';

/**
 * Bandeau discret sous le header :
 *  - hors-ligne            → "Hors ligne" (gris)
 *  - en ligne + sync/queue → "Synchronisation… (N)" (accent)
 *  - sinon                 → masqué
 */
export const SyncBanner: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { online, syncing, pending } = useSync();

  const show = !online || syncing || pending > 0;
  const height = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(height, {
      toValue: show ? 30 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [show, height]);

  const offline = !online;
  const bg = offline ? theme.colors.surfaceAlt : theme.colors.primary + '18';
  const fg = offline ? theme.colors.textMuted : theme.colors.primary;
  const label = offline
    ? t('sync.offline')
    : pending > 0
      ? t('sync.pendingCount', { count: pending })
      : t('sync.syncing');

  return (
    <Animated.View style={[styles.wrap, { height, backgroundColor: bg }]}>
      <View style={styles.row}>
        <Icon name={offline ? 'cloud-off-outline' : 'sync'} size={14} color={fg} />
        <Text style={[styles.text, { color: fg }]}>{label}</Text>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  text: { fontSize: 12, fontWeight: '600' },
});
