import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';

interface Props {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: ViewStyle;
  padded?: boolean;
}

export const Screen: React.FC<Props> = ({
  children,
  edges = ['top', 'bottom'],
  style,
  padded = false,
}) => {
  const { theme } = useTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      <View style={[styles.flex, padded && { padding: theme.spacing.lg }, style]}>{children}</View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({ flex: { flex: 1 } });
