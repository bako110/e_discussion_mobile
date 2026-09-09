/** Config partagée des stories (inspiré de stream_mobile). */

export const STORY_BG_COLORS = [
  '#1E6FE0',
  '#0F9D58',
  '#E5484D',
  '#7C4DFF',
  '#F59E0B',
  '#111827',
  '#0EA5E9',
  '#DB2777',
  '#16A34A',
  '#9333EA',
];

export interface StoryFont {
  key: string;
  label: string;
  style: {
    fontFamily?: string;
    fontWeight?: 'normal' | 'bold' | '900';
    fontStyle?: 'normal' | 'italic';
    letterSpacing?: number;
  };
}

export const STORY_FONTS: StoryFont[] = [
  { key: 'classic', label: 'Aa', style: { fontWeight: 'bold' } },
  { key: 'serif', label: 'Aa', style: { fontFamily: 'serif', fontWeight: 'normal' } },
  { key: 'mono', label: 'Aa', style: { fontFamily: 'monospace', fontWeight: 'bold' } },
  { key: 'italic', label: 'Aa', style: { fontFamily: 'serif', fontStyle: 'italic' } },
  { key: 'wide', label: 'Aa', style: { fontWeight: '900', letterSpacing: 2 } },
];

export function fontStyle(key: string | null | undefined) {
  return STORY_FONTS.find((f) => f.key === key)?.style ?? STORY_FONTS[0]!.style;
}

/** Gradient déterministe depuis un nom (fond de carte sans média). */
const PALETTES: [string, string][] = [
  ['#7B3FF2', '#E0389A'],
  ['#3B82F6', '#06B6D4'],
  ['#22C55E', '#36D9A0'],
  ['#F59E0B', '#FF7A2F'],
  ['#F0365A', '#E0389A'],
  ['#8B5CF6', '#6366F1'],
];

export function paletteBySeed(seed: string): [string, string] {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTES[h % PALETTES.length]!;
}

/** Réactions rapides du viewer (icônes MaterialCommunityIcons). */
export const QUICK_REACTIONS = [
  'heart',
  'emoticon-lol',
  'emoticon-cry',
  'fire',
  'thumb-up',
  'hand-clap',
];

/** Couleurs de pinceau pour l'éditeur média (dessin par-dessus). */
export const DRAW_COLORS = [
  '#FFFFFF',
  '#111827',
  '#E5484D',
  '#F59E0B',
  '#16A34A',
  '#1E6FE0',
  '#7C4DFF',
  '#DB2777',
];

/** Stickers emoji proposés dans l'éditeur. */
export const STICKER_EMOJIS = [
  '😂', '😍', '🔥', '🎉', '❤️', '👍', '😮', '😢',
  '🙌', '💯', '✨', '👑', '🥳', '😎', '🤔', '💪',
];
