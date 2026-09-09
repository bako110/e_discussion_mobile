/**
 * i18n frontend (i18next + react-i18next). La langue est persistée en MMKV et
 * propagée à l'API via `setApiLocale` (header X-Lang) — le backend renvoie
 * alors ses messages d'erreur dans la même langue.
 */
import { NativeModules, Platform } from 'react-native';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import { setApiLocale } from '@/api/client';
import { StorageKeys, storage } from '@/utils/storage';

import en from './locales/en.json';
import fr from './locales/fr.json';

export const SUPPORTED_LOCALES = ['fr', 'en'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

function deviceLocale(): Locale {
  const raw =
    Platform.OS === 'ios'
      ? NativeModules.SettingsManager?.settings?.AppleLocale ??
        NativeModules.SettingsManager?.settings?.AppleLanguages?.[0]
      : NativeModules.I18nManager?.localeIdentifier;
  const lang = String(raw ?? 'fr').slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(lang) ? (lang as Locale) : 'fr';
}

const initial = (storage.getString(StorageKeys.LOCALE) as Locale) ?? deviceLocale();

i18n.use(initReactI18next).init({
  resources: { fr: { translation: fr }, en: { translation: en } },
  lng: initial,
  fallbackLng: 'fr',
  interpolation: { escapeValue: false },
});

setApiLocale(initial);

export function setLocale(locale: Locale): void {
  storage.set(StorageKeys.LOCALE, locale);
  setApiLocale(locale);
  void i18n.changeLanguage(locale);
}

export default i18n;
