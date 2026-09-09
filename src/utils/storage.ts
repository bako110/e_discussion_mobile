/**
 * Stockage clé-valeur synchrone (MMKV, non chiffré) — préférences, cache
 * léger. Les secrets d'auth vont dans le Keychain (voir authService), les
 * clés E2EE dans une instance MMKV chiffrée séparée (voir crypto/keyStore).
 */
import { MMKV } from 'react-native-mmkv';

const mmkv = new MMKV({ id: 'ediscussion-storage' });

export const storage = {
  getString: (key: string): string | undefined => mmkv.getString(key),
  set: (key: string, value: string | number | boolean): void => mmkv.set(key, value),
  getBoolean: (key: string): boolean | undefined => mmkv.getBoolean(key),
  getNumber: (key: string): number | undefined => mmkv.getNumber(key),
  delete: (key: string): void => mmkv.delete(key),
  clearAll: (): void => mmkv.clearAll(),

  getJSON: <T>(key: string): T | null => {
    const raw = mmkv.getString(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },
  setJSON: (key: string, value: unknown): void => {
    mmkv.set(key, JSON.stringify(value));
  },
};

export const StorageKeys = {
  ONBOARDING_DONE: 'onboarding_done',
  THEME_MODE: 'theme_mode',
  LOCALE: 'locale',
  CACHED_ME: 'cached_me',
} as const;
