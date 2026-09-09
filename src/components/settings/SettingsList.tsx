import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

/** Groupe de lignes avec titre de section (style iOS/WhatsApp). */
export const SettingsSection: React.FC<{ title?: string; children: React.ReactNode }> = ({
  title,
  children,
}) => {
  const { theme } = useTheme();
  const c = theme.colors;
  return (
    <View style={styles.section}>
      {title ? (
        <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{title}</Text>
      ) : null}
      <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
        {children}
      </View>
    </View>
  );
};

/** Ligne de réglage : icône + libellé + (valeur | chevron). */
export const SettingsRow: React.FC<{
  icon: string;
  label: string;
  value?: string | null;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
  /** Force le chevron même sans `value` (ligne de navigation). */
  chevron?: boolean;
}> = ({ icon, label, value, onPress, danger, last, chevron }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const showChevron = (chevron ?? !!onPress) && !danger;
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      android_ripple={onPress ? { color: c.surfaceAlt } : undefined}
      style={[
        styles.row,
        !last && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name={icon} size={20} color={danger ? c.danger : c.textMuted} />
      <Text style={[styles.rowLabel, { color: danger ? c.danger : c.text }]} numberOfLines={1}>
        {label}
      </Text>
      {value ? (
        <Text style={[styles.rowValue, { color: c.textFaint }]} numberOfLines={1}>
          {value}
        </Text>
      ) : null}
      {showChevron ? <Icon name="chevron-right" size={20} color={c.textFaint} /> : null}
    </Pressable>
  );
};

const styles = StyleSheet.create({
  section: { marginTop: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 14 },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  rowValue: { fontSize: 14, maxWidth: 180 },
});
