import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';

import { type AppTheme, createTheme } from '@/theme';
import { StorageKeys, storage } from '@/utils/storage';

export type ThemeMode = 'light' | 'dark' | 'system';

interface ThemeContextValue {
  theme: AppTheme;
  mode: ThemeMode;
  isDark: boolean;
  setMode: (m: ThemeMode) => void;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const systemScheme = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>(
    () => (storage.getString(StorageKeys.THEME_MODE) as ThemeMode) ?? 'system',
  );

  const isDark = useMemo(
    () => (mode === 'system' ? systemScheme === 'dark' : mode === 'dark'),
    [mode, systemScheme],
  );
  const theme = useMemo(() => createTheme(isDark), [isDark]);

  // La status bar est pilotee par <AppHeader> (chaque ecran declare son
  // header) — pas de setBarStyle global ici pour eviter les conflits.

  const setMode = useCallback((m: ThemeMode) => {
    storage.set(StorageKeys.THEME_MODE, m);
    setModeState(m);
  }, []);

  const toggle = useCallback(() => setMode(isDark ? 'light' : 'dark'), [isDark, setMode]);

  const value = useMemo(
    () => ({ theme, mode, isDark, setMode, toggle }),
    [theme, mode, isDark, setMode, toggle],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
