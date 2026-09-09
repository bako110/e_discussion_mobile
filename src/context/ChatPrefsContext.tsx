/**
 * Préférences d'affichage des conversations (locales, MMKV) :
 *  - taille de police des messages (small / medium / large),
 *  - fond d'écran de conversation (couleur unie ou dégradé prédéfini),
 *  - « Entrée = envoyer ».
 *
 * Exposé à toute l'app pour que ChatScreen / GroupChatScreen s'y abonnent.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from 'react';

import { storage } from '@/utils/storage';

export type FontSize = 'small' | 'medium' | 'large';

/** Fonds proposés. `key` stocké en MMKV ; `type` pilote le rendu. */
export interface ChatWallpaper {
  key: string;
  type: 'solid' | 'gradient';
  colors: string[]; // 1 couleur (solid) ou 2+ (gradient)
  dark?: boolean; // fond sombre -> texte des méta en clair
}

export const CHAT_WALLPAPERS: ChatWallpaper[] = [
  { key: 'default', type: 'solid', colors: [''] }, // '' = thème par défaut
  { key: 'paper', type: 'solid', colors: ['#F3EFE7'] },
  { key: 'mint', type: 'solid', colors: ['#E7F4EE'] },
  { key: 'sky', type: 'solid', colors: ['#E8F0FB'] },
  { key: 'dusk', type: 'gradient', colors: ['#1E293B', '#0F172A'], dark: true },
  { key: 'ocean', type: 'gradient', colors: ['#0EA5E9', '#2563EB'], dark: true },
  { key: 'sunset', type: 'gradient', colors: ['#F97316', '#DB2777'], dark: true },
];

const K_FONT = 'chats.fontSize';
const K_WALLPAPER = 'chats.wallpaper';
const K_ENTER_SEND = 'chats.enterToSend';

const FONT_SCALE: Record<FontSize, number> = { small: 0.9, medium: 1, large: 1.15 };

interface ChatPrefsValue {
  fontSize: FontSize;
  fontScale: number;
  wallpaper: ChatWallpaper;
  enterToSend: boolean;
  setFontSize: (v: FontSize) => void;
  setWallpaperKey: (key: string) => void;
  setEnterToSend: (v: boolean) => void;
}

const Ctx = createContext<ChatPrefsValue | null>(null);

function readFont(): FontSize {
  const v = storage.getString(K_FONT);
  return v === 'small' || v === 'large' ? v : 'medium';
}
function readWallpaper(): ChatWallpaper {
  const key = storage.getString(K_WALLPAPER) ?? 'default';
  return CHAT_WALLPAPERS.find((w) => w.key === key) ?? CHAT_WALLPAPERS[0]!;
}
function readEnterSend(): boolean {
  return storage.getBoolean(K_ENTER_SEND) ?? false;
}

export const ChatPrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [fontSize, setFontSizeState] = useState<FontSize>(readFont);
  const [wallpaper, setWallpaperState] = useState<ChatWallpaper>(readWallpaper);
  const [enterToSend, setEnterSendState] = useState<boolean>(readEnterSend);

  const setFontSize = useCallback((v: FontSize) => {
    storage.set(K_FONT, v);
    setFontSizeState(v);
  }, []);

  const setWallpaperKey = useCallback((key: string) => {
    storage.set(K_WALLPAPER, key);
    setWallpaperState(CHAT_WALLPAPERS.find((w) => w.key === key) ?? CHAT_WALLPAPERS[0]!);
  }, []);

  const setEnterToSend = useCallback((v: boolean) => {
    storage.set(K_ENTER_SEND, v);
    setEnterSendState(v);
  }, []);

  const value = useMemo<ChatPrefsValue>(
    () => ({
      fontSize,
      fontScale: FONT_SCALE[fontSize],
      wallpaper,
      enterToSend,
      setFontSize,
      setWallpaperKey,
      setEnterToSend,
    }),
    [fontSize, wallpaper, enterToSend, setFontSize, setWallpaperKey, setEnterToSend],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useChatPrefs(): ChatPrefsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useChatPrefs must be used within ChatPrefsProvider');
  return ctx;
}
