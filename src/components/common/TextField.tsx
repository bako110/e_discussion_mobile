import React, { useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

import { useTheme } from '@/context/ThemeContext';

interface Props extends TextInputProps {
  label?: string;
  error?: string | null;
}

export const TextField: React.FC<Props> = ({ label, error, style, ...rest }) => {
  const { theme } = useTheme();
  const c = theme.colors;
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      {label ? (
        <Text style={[styles.label, { color: c.textMuted, fontSize: theme.fontSize.sm }]}>
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={c.textFaint}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={[
          styles.input,
          {
            color: c.text,
            backgroundColor: c.surface,
            borderColor: error ? c.danger : focused ? c.primary : c.border,
            borderRadius: theme.radius.md,
            fontSize: theme.fontSize.md,
          },
          style,
        ]}
        {...rest}
      />
      {error ? (
        <Text style={[styles.error, { color: c.danger, fontSize: theme.fontSize.xs }]}>{error}</Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: { marginBottom: 6, fontWeight: '500' },
  input: {
    height: 52,
    borderWidth: 1.5,
    paddingHorizontal: 14,
  },
  error: { marginTop: 4 },
});
