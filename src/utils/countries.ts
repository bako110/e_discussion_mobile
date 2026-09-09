/**
 * Liste des pays pour le selecteur d'indicatif telephonique.
 * `dial` = indicatif sans '+', `flag` = emoji drapeau, `iso` = code ISO 3166-1.
 * Liste volontairement large mais pas exhaustive (les principaux + Afrique
 * francophone). Ajouter des entrees ici au besoin.
 */
export interface Country {
  iso: string;
  name: string;
  dial: string;
  flag: string;
}

export const COUNTRIES: Country[] = [
  { iso: 'FR', name: 'France', dial: '33', flag: '🇫🇷' },
  { iso: 'BE', name: 'Belgique', dial: '32', flag: '🇧🇪' },
  { iso: 'CH', name: 'Suisse', dial: '41', flag: '🇨🇭' },
  { iso: 'CA', name: 'Canada', dial: '1', flag: '🇨🇦' },
  { iso: 'US', name: 'États-Unis', dial: '1', flag: '🇺🇸' },
  { iso: 'GB', name: 'Royaume-Uni', dial: '44', flag: '🇬🇧' },
  { iso: 'DE', name: 'Allemagne', dial: '49', flag: '🇩🇪' },
  { iso: 'ES', name: 'Espagne', dial: '34', flag: '🇪🇸' },
  { iso: 'IT', name: 'Italie', dial: '39', flag: '🇮🇹' },
  { iso: 'PT', name: 'Portugal', dial: '351', flag: '🇵🇹' },
  { iso: 'NL', name: 'Pays-Bas', dial: '31', flag: '🇳🇱' },
  { iso: 'MA', name: 'Maroc', dial: '212', flag: '🇲🇦' },
  { iso: 'DZ', name: 'Algérie', dial: '213', flag: '🇩🇿' },
  { iso: 'TN', name: 'Tunisie', dial: '216', flag: '🇹🇳' },
  { iso: 'SN', name: 'Sénégal', dial: '221', flag: '🇸🇳' },
  { iso: 'CI', name: "Côte d'Ivoire", dial: '225', flag: '🇨🇮' },
  { iso: 'CM', name: 'Cameroun', dial: '237', flag: '🇨🇲' },
  { iso: 'BF', name: 'Burkina Faso', dial: '226', flag: '🇧🇫' },
  { iso: 'ML', name: 'Mali', dial: '223', flag: '🇲🇱' },
  { iso: 'NE', name: 'Niger', dial: '227', flag: '🇳🇪' },
  { iso: 'GN', name: 'Guinée', dial: '224', flag: '🇬🇳' },
  { iso: 'TG', name: 'Togo', dial: '228', flag: '🇹🇬' },
  { iso: 'BJ', name: 'Bénin', dial: '229', flag: '🇧🇯' },
  { iso: 'GA', name: 'Gabon', dial: '241', flag: '🇬🇦' },
  { iso: 'CG', name: 'Congo', dial: '242', flag: '🇨🇬' },
  { iso: 'CD', name: 'RD Congo', dial: '243', flag: '🇨🇩' },
  { iso: 'MG', name: 'Madagascar', dial: '261', flag: '🇲🇬' },
  { iso: 'RW', name: 'Rwanda', dial: '250', flag: '🇷🇼' },
  { iso: 'TD', name: 'Tchad', dial: '235', flag: '🇹🇩' },
  { iso: 'MR', name: 'Mauritanie', dial: '222', flag: '🇲🇷' },
  { iso: 'NG', name: 'Nigéria', dial: '234', flag: '🇳🇬' },
  { iso: 'GH', name: 'Ghana', dial: '233', flag: '🇬🇭' },
  { iso: 'KE', name: 'Kenya', dial: '254', flag: '🇰🇪' },
  { iso: 'ZA', name: 'Afrique du Sud', dial: '27', flag: '🇿🇦' },
  { iso: 'EG', name: 'Égypte', dial: '20', flag: '🇪🇬' },
  { iso: 'AE', name: 'Émirats arabes unis', dial: '971', flag: '🇦🇪' },
  { iso: 'SA', name: 'Arabie saoudite', dial: '966', flag: '🇸🇦' },
  { iso: 'TR', name: 'Turquie', dial: '90', flag: '🇹🇷' },
  { iso: 'IN', name: 'Inde', dial: '91', flag: '🇮🇳' },
  { iso: 'BR', name: 'Brésil', dial: '55', flag: '🇧🇷' },
];

export const DEFAULT_COUNTRY = COUNTRIES[0];

/** Assemble un numero E.164 a partir d'un pays et de la saisie locale
 * (on retire le 0 initial des numeros nationaux type FR/BE). */
export function toE164(country: Country, local: string): string {
  const digits = local.replace(/\D/g, '').replace(/^0+/, '');
  return `+${country.dial}${digits}`;
}

/** Affichage lisible : "+33 6 12 34 56 78" (groupes de 2, best-effort). */
export function formatPretty(country: Country, local: string): string {
  const digits = local.replace(/\D/g, '').replace(/^0+/, '');
  const groups = digits.match(/.{1,2}/g) ?? [];
  return `+${country.dial} ${groups.join(' ')}`.trim();
}
