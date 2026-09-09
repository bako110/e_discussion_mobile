import { AppColors, DarkColors, LightColors } from './colors';

export const Spacing = {
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
} as const;

export const Radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  pill: 999,
} as const;

export const FontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 26,
  title: 32,
} as const;

export const FontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

export const createTheme = (isDark: boolean) => ({
  isDark,
  colors: isDark ? DarkColors : LightColors,
  spacing: Spacing,
  radius: Radius,
  fontSize: FontSize,
  fontWeight: FontWeight,
});

export type AppTheme = ReturnType<typeof createTheme>;
export type { AppColors };
export { LightColors, DarkColors };
export * from './colors';
