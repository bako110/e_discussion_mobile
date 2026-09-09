import React from 'react';
import { Alert, Linking, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, BrandLogo, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

import { APP_VERSION } from './SettingsScreen';

export const AboutSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.about')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={styles.brand}>
          <BrandLogo variant="mark" />
          <Text style={[styles.appName, { color: c.text }]}>E-discussion</Text>
          <Text style={[styles.version, { color: c.textMuted }]}>
            {t('settings.version')} {APP_VERSION}
          </Text>
        </View>

        <SettingsSection>
          <SettingsRow
            icon="star-outline"
            label={t('settings.rateApp')}
            onPress={() => Alert.alert(t('settings.rateApp'), t('settings.comingSoon'))}
          />
          <SettingsRow
            icon="share-variant-outline"
            label={t('settings.shareApp')}
            onPress={() =>
              void Share.share({
                message: t('settings.shareAppText'),
              }).catch(() => undefined)
            }
          />
          <SettingsRow
            icon="web"
            label={t('settings.website')}
            onPress={() =>
              void Linking.openURL('https://e-discussion.app').catch(() => undefined)
            }
            last
          />
        </SettingsSection>

        <Text style={[styles.legal, { color: c.textFaint }]}>{t('settings.aboutLegal')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  brand: { alignItems: 'center', gap: 8, paddingVertical: 28 },
  appName: { fontSize: 22, fontWeight: '800', letterSpacing: -0.4, marginTop: 6 },
  version: { fontSize: 13 },
  legal: { fontSize: 12, textAlign: 'center', marginTop: 20, lineHeight: 17 },
});
