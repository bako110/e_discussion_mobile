import React from 'react';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { useTheme } from '@/context/ThemeContext';

import { DoodleBackground } from './DoodleBackground';

interface Props {
  children: React.ReactNode;
  edges?: readonly Edge[];
  style?: ViewStyle;
  padded?: boolean;
  /** Fond décoratif à petites icônes façon Telegram, activé par défaut sur
   * tous les écrans. `false` pour un écran qui gère déjà son propre fond
   * (ex. ChatScreen avec son système de wallpaper). */
  doodles?: boolean;
}

export const Screen: React.FC<Props> = ({
  children,
  edges = ['top', 'bottom'],
  style,
  padded = false,
  doodles = true,
}) => {
  const { theme } = useTheme();
  return (
    <SafeAreaView
      edges={edges}
      style={[styles.flex, { backgroundColor: theme.colors.background }]}
    >
      {/* le fond éventuellement passé via `style` (ex. ChatScreen et son
          wallpaper) est opaque — le doodle doit être rendu APRÈS ce fond
          (donc visuellement PAR-DESSUS), en position absolue et
          `pointerEvents="none"` pour rester purement décoratif, sinon il
          reste invisible sous n'importe quel `backgroundColor` custom. */}
      <View style={[styles.flex, padded && { padding: theme.spacing.lg }, style]}>{children}</View>
      {doodles ? <DoodleBackground /> : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({ flex: { flex: 1 } });
