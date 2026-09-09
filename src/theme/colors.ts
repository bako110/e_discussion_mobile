/**
 * Palette E-discussion — dérivée du logo (bulle « e » bleue + bulle verte).
 *
 *   primaire   #2F80ED  bleu du « E » et du mot
 *   primaireHi #4DA3FF  bleu clair (haut du dégradé)
 *   primaireLo #1B6FE0  bleu profond (bas du dégradé)
 *   accent     #27AE79  vert de la bulle de droite
 *   encre      #0F1B3D  bleu nuit (texte sombre)
 */

export interface AppColors {
  // marque
  primary: string;
  primaryHi: string;
  primaryLo: string;
  accent: string;
  onPrimary: string;

  // header applicatif (fond bleu plein facon WhatsApp)
  headerBg: string;
  onHeader: string;
  onHeaderMuted: string;

  // surfaces
  background: string;
  surface: string;
  surfaceAlt: string;
  card: string;

  // texte
  text: string;
  textMuted: string;
  textFaint: string;

  // lignes / états
  border: string;
  divider: string;
  success: string;
  warning: string;
  danger: string;

  // chat
  bubbleOut: string;
  bubbleOutText: string;
  bubbleIn: string;
  bubbleInText: string;
  chatBackground: string;

  // divers
  online: string;
  overlay: string;
}

const BRAND = {
  primary: '#2F80ED',
  primaryHi: '#4DA3FF',
  primaryLo: '#1B6FE0',
  accent: '#27AE79',
};

export const LightColors: AppColors = {
  ...BRAND,
  onPrimary: '#FFFFFF',

  headerBg: '#1E6FE0',
  onHeader: '#FFFFFF',
  onHeaderMuted: 'rgba(255,255,255,0.82)',

  background: '#FFFFFF',
  surface: '#F5F8FE',
  surfaceAlt: '#EEF3FC',
  card: '#FFFFFF',

  text: '#0F1B3D',
  textMuted: '#5A6784',
  textFaint: '#95A0B8',

  border: '#DDE6F4',
  divider: '#EAF0FA',
  success: '#27AE79',
  warning: '#E8A13C',
  danger: '#E5484D',

  bubbleOut: '#2F80ED',
  bubbleOutText: '#FFFFFF',
  bubbleIn: '#EEF3FC',
  bubbleInText: '#0F1B3D',
  chatBackground: '#F5F8FE',

  online: '#27AE79',
  overlay: 'rgba(15,27,61,0.45)',
};

export const DarkColors: AppColors = {
  ...BRAND,
  primary: '#4DA3FF',
  primaryHi: '#6FB6FF',
  primaryLo: '#2F80ED',
  onPrimary: '#06122B',

  headerBg: '#12213B',
  onHeader: '#EAF1FF',
  onHeaderMuted: 'rgba(234,241,255,0.7)',

  background: '#0B1220',
  surface: '#131C2E',
  surfaceAlt: '#1A2436',
  card: '#151F32',

  text: '#EAF1FF',
  textMuted: '#9DAAC4',
  textFaint: '#66748F',

  border: '#26324A',
  divider: '#1E2A40',
  success: '#2BB673',
  warning: '#E8A13C',
  danger: '#F0575C',

  bubbleOut: '#2F6FD0',
  bubbleOutText: '#FFFFFF',
  bubbleIn: '#1C2841',
  bubbleInText: '#EAF1FF',
  chatBackground: '#0B1220',

  online: '#2BB673',
  overlay: 'rgba(0,0,0,0.55)',
};

export const BrandGradient = [BRAND.primaryHi, BRAND.primary, BRAND.accent];
