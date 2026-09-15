import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { storage } from '@/utils/storage';

/** Ligne avec interrupteur — préférence locale persistée en MMKV. */
export const ToggleRow: React.FC<{
  icon: string;
  label: string;
  /** Courte explication sous le libellé, façon Réglages iOS/Android. */
  description?: string;
  storageKey: string;
  defaultValue?: boolean;
  last?: boolean;
}> = ({ icon, label, description, storageKey, defaultValue = true, last }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const [on, setOn] = useState<boolean>(() => {
    try {
      const v = storage.getString(storageKey);
      return v == null ? defaultValue : v === '1';
    } catch {
      return defaultValue;
    }
  });
  const toggle = (next: boolean) => {
    setOn(next);
    try {
      storage.set(storageKey, next ? '1' : '0');
    } catch {
      /* stockage indispo — l'UI reste coherente pour la session */
    }
  };
  return (
    <View
      style={[
        styles.row,
        description ? styles.rowWithDescription : null,
        !last && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name={icon} size={20} color={c.textMuted} />
      <View style={styles.body}>
        <Text style={[styles.label, { color: c.text }]}>{label}</Text>
        {description ? (
          <Text style={[styles.description, { color: c.textFaint }]} numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      <Switch
        value={on}
        onValueChange={toggle}
        trackColor={{ true: c.primary, false: c.border }}
        thumbColor="#fff"
      />
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 9,
    minHeight: 52,
  },
  rowWithDescription: { alignItems: 'flex-start', paddingVertical: 10 },
  body: { flex: 1 },
  label: { fontSize: 15, fontWeight: '500' },
  description: { fontSize: 12, marginTop: 2, lineHeight: 16 },
});
