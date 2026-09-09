import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsSection } from '@/components/settings';
import { useTheme, type ThemeMode } from '@/context/ThemeContext';
import { SUPPORTED_LOCALES, setLocale, type Locale } from '@/i18n';
import type { MainNav } from '@/navigation/types';

export const AppearanceSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t, i18n } = useTranslation();
  const { theme, mode, setMode } = useTheme();
  const c = theme.colors;

  const themeOpts: { key: ThemeMode; label: string }[] = [
    { key: 'system', label: t('settings.themeSystem') },
    { key: 'light', label: t('settings.themeLight') },
    { key: 'dark', label: t('settings.themeDark') },
  ];

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.appearance')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SettingsSection title={t('settings.theme')}>
          <View style={styles.rowStatic}>
            <Icon name="theme-light-dark" size={20} color={c.textMuted} />
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings.theme')}</Text>
          </View>
          <View style={[styles.segment, { borderColor: c.border, marginBottom: 12 }]}>
            {themeOpts.map((o) => (
              <Pressable
                key={o.key}
                onPress={() => setMode(o.key)}
                style={[styles.seg, mode === o.key && { backgroundColor: c.primary }]}
              >
                <Text
                  style={{
                    color: mode === o.key ? c.onPrimary : c.textMuted,
                    fontWeight: '600',
                    fontSize: 13,
                  }}
                >
                  {o.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </SettingsSection>

        <SettingsSection title={t('settings.language')}>
          <View style={styles.rowStatic}>
            <Icon name="translate" size={20} color={c.textMuted} />
            <Text style={[styles.rowLabel, { color: c.text }]}>{t('settings.language')}</Text>
          </View>
          <View style={[styles.segment, { borderColor: c.border, marginBottom: 12 }]}>
            {SUPPORTED_LOCALES.map((l) => (
              <Pressable
                key={l}
                onPress={() => setLocale(l as Locale)}
                style={[styles.seg, i18n.language === l && { backgroundColor: c.primary }]}
              >
                <Text
                  style={{
                    color: i18n.language === l ? c.onPrimary : c.textMuted,
                    fontWeight: '600',
                    fontSize: 13,
                  }}
                >
                  {l.toUpperCase()}
                </Text>
              </Pressable>
            ))}
          </View>
        </SettingsSection>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  rowStatic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 4,
  },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  segment: { flexDirection: 'row', borderWidth: 1, borderRadius: 10, padding: 3, marginHorizontal: 12, marginTop: 4 },
  seg: { flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8 },
});
