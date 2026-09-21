/**
 * Bandeau compact sous le header du chat — rappel discret du PROCHAIN RDV à
 * venir avec ce partenaire (un seul, le plus proche). Tap -> détail du RDV.
 * S'anime en hauteur comme SyncBanner ; masqué si aucun RDV à venir.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { Appointment } from '@/types';

interface Props {
  appointment: Appointment | null;
  onPress: () => void;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `${day} · ${time}`;
}

export const NextAppointmentBanner: React.FC<Props> = ({ appointment, onPress }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const show = !!appointment;
  const height = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(height, {
      toValue: show ? 34 : 0,
      duration: 180,
      useNativeDriver: false,
    }).start();
  }, [show, height]);

  return (
    <Animated.View style={[styles.wrap, { height, backgroundColor: c.primary + '14' }]}>
      {appointment ? (
        <Pressable onPress={onPress} style={styles.row}>
          <Icon name="calendar-clock" size={14} color={c.primary} />
          <Text style={[styles.text, { color: c.primary }]} numberOfLines={1}>
            {t('appointments.chatBannerLabel', { title: appointment.title })} · {formatWhen(appointment.scheduled_at)}
          </Text>
          <Icon name="chevron-right" size={14} color={c.primary} />
        </Pressable>
      ) : (
        <View />
      )}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14 },
  text: { flex: 1, fontSize: 12.5, fontWeight: '700' },
});
