import React from 'react';
import { StatusBar } from 'react-native';

import { useTheme } from '@/context/ThemeContext';

/**
 * Status bar par defaut (ecrans SANS <AppHeader> : splash, auth, onboarding).
 * Translucide, icones adaptees au theme. Les ecrans avec header brand
 * surchargent temporairement en clair via leur propre <StatusBar>.
 */
export const ThemedStatusBar: React.FC = () => {
  const { isDark } = useTheme();
  return (
    <StatusBar
      translucent
      backgroundColor="transparent"
      barStyle={isDark ? 'light-content' : 'dark-content'}
      animated
    />
  );
};
