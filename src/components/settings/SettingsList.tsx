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

/** Ligne de réglage : icône + libellé (+ description) + (valeur | chevron). */
export const SettingsRow: React.FC<{
  icon: string;
  label: string;
  /** Courte explication sous le libellé (façon iOS/Android Settings) — pour
   * qu'on comprenne à quoi sert l'option sans avoir à l'ouvrir. */
  description?: string;
  value?: string | null;
  onPress?: () => void;
  danger?: boolean;
  last?: boolean;
  /** Force le chevron même sans `value` (ligne de navigation). */
  chevron?: boolean;
  /** Couleur d'icône ponctuelle (ex: rouge « en direct ») — sans affecter le
   * libellé, contrairement à `danger` qui colore aussi le texte. */
  iconColor?: string;
}> = ({ icon, label, description, value, onPress, danger, last, chevron, iconColor }) => {
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
        description ? styles.rowWithDescription : null,
        !last && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name={icon} size={20} color={iconColor ?? (danger ? c.danger : c.textMuted)} />
      <View style={styles.rowBody}>
        <Text style={[styles.rowLabel, { color: danger ? c.danger : c.text }]} numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text style={[styles.rowDescription, { color: c.textMuted }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
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
  rowWithDescription: { alignItems: 'flex-start', paddingVertical: 12 },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  rowDescription: { fontSize: 12.5, lineHeight: 17, marginTop: 2 },
  rowValue: { fontSize: 14, maxWidth: 180 },
});
