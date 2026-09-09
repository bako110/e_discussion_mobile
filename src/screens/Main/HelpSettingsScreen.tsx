import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

const open = (url: string) => void Linking.openURL(url).catch(() => undefined);

export const HelpSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.help')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SettingsSection title={t('settings.support')}>
          <SettingsRow
            icon="frequently-asked-questions"
            label={t('settings.faq')}
            onPress={() => open('https://e-discussion.app/faq')}
          />
          <SettingsRow
            icon="email-fast-outline"
            label={t('settings.contactUs')}
            onPress={() => open('mailto:support@e-discussion.app')}
          />
          <SettingsRow
            icon="bug-outline"
            label={t('settings.reportProblem')}
            onPress={() => open('mailto:support@e-discussion.app?subject=Bug')}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.legal')}>
          <SettingsRow
            icon="file-document-outline"
            label={t('settings.terms')}
            onPress={() => open('https://e-discussion.app/terms')}
          />
          <SettingsRow
            icon="shield-account-outline"
            label={t('settings.privacyPolicy')}
            onPress={() => open('https://e-discussion.app/privacy')}
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.helpNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
