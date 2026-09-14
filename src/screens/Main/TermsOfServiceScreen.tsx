/** Conditions d'utilisation — texte statique natif. */
import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

const SECTION_KEYS = Array.from({ length: 12 }, (_, i) => `s${i + 1}`);

export const TermsOfServiceScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.terms')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={[styles.updated, { color: c.textFaint }]}>{t('terms.updated')}</Text>
        <Text style={[styles.intro, { color: c.textMuted }]}>{t('terms.intro')}</Text>

        {SECTION_KEYS.map((key) => (
          <React.Fragment key={key}>
            <Text style={[styles.h2, { color: c.text }]}>{t(`terms.${key}_title`)}</Text>
            <Text style={[styles.body, { color: c.textMuted }]}>{t(`terms.${key}_body`)}</Text>
          </React.Fragment>
        ))}
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 20, paddingBottom: 48 },
  updated: { fontSize: 12, marginBottom: 4 },
  intro: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  h2: { fontSize: 15.5, fontWeight: '700', marginTop: 18, marginBottom: 6 },
  body: { fontSize: 14, lineHeight: 21 },
});
