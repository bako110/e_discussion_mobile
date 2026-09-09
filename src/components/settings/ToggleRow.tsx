import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { storage } from '@/utils/storage';

/** Ligne avec interrupteur — préférence locale persistée en MMKV. */
export const ToggleRow: React.FC<{
  icon: string;
  label: string;
  storageKey: string;
  defaultValue?: boolean;
  last?: boolean;
}> = ({ icon, label, storageKey, defaultValue = true, last }) => {
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
        !last && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
      ]}
    >
      <Icon name={icon} size={20} color={c.textMuted} />
      <Text style={[styles.label, { color: c.text }]}>{label}</Text>
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
  label: { flex: 1, fontSize: 15, fontWeight: '500' },
});
