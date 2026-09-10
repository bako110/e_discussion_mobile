import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection, ToggleRow } from '@/components/settings';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

export const NotificationsSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.notifications')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SettingsSection title={t('notifHistory.title')}>
          <SettingsRow
            icon="history"
            label={t('notifHistory.open')}
            onPress={() => navigation.navigate('NotificationHistory')}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifShow')}>
          <ToggleRow
            icon="message-badge-outline"
            label={t('settings.notifMessages')}
            storageKey="notif.messages"
          />
          <ToggleRow icon="phone-ring-outline" label={t('settings.notifCalls')} storageKey="notif.calls" />
          <ToggleRow
            icon="circle-slice-8"
            label={t('settings.notifStories')}
            storageKey="notif.stories"
            defaultValue={false}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifAlert')}>
          <ToggleRow icon="volume-high" label={t('settings.notifSound')} storageKey="notif.sound" />
          <ToggleRow
            icon="vibrate"
            label={t('settings.notifVibrate')}
            storageKey="notif.vibrate"
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifPreview')}>
          <ToggleRow
            icon="eye-outline"
            label={t('settings.notifShowPreview')}
            storageKey="notif.preview"
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.notifNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
