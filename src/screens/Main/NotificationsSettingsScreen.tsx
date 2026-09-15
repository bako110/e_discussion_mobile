import React, { useCallback, useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection, ToggleRow } from '@/components/settings';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import {
  canUseFullScreenIntent,
  isIgnoringBatteryOptimizations,
  openAppSettings,
  openFullScreenIntentSettings,
  openNotificationChannelSettings,
  requestIgnoreBatteryOptimizations,
} from '@/services/batteryOptimization';

/** Doit correspondre EXACTEMENT à `BackgroundKeepAliveService.CHANNEL_ID`
 * côté natif (android/.../BackgroundKeepAliveService.kt). */
const KEEPALIVE_CHANNEL_ID = 'keepalive_v1';

export const NotificationsSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  // Statut de l'exemption batterie — sans elle, certains OEM (Transsion/
  // Infinix/Tecno) coupent silencieusement les push en arrière-plan. On
  // revérifie à chaque retour sur l'écran (l'utilisateur peut revenir des
  // réglages système après avoir accordé/refusé).
  const [batteryExempt, setBatteryExempt] = useState<boolean | null>(null);
  const checkBattery = useCallback(() => {
    void isIgnoringBatteryOptimizations().then(setBatteryExempt);
  }, []);
  useFocusEffect(checkBattery);

  // Permission "notification plein écran" (Android 14+) — SANS elle, un
  // appel entrant ne sonne plus jamais façon "vrai appel" (écran + sonnerie
  // qui se lancent seuls) : il reste une simple notification cliquable,
  // exactement le symptôme le plus souvent signalé. Revérifié à chaque
  // retour sur l'écran (l'utilisateur peut revenir des réglages système
  // après avoir accordé/refusé).
  const [fullScreenOk, setFullScreenOk] = useState<boolean | null>(null);
  const checkFullScreen = useCallback(() => {
    void canUseFullScreenIntent().then(setFullScreenOk);
  }, []);
  useFocusEffect(checkFullScreen);

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
        {Platform.OS === 'android' && fullScreenOk === false ? (
          <>
            <SettingsSection title={t('settings.notifReliability')}>
              <SettingsRow
                icon="cellphone-arrow-down"
                label={t('settings.notifFullScreen')}
                onPress={async () => {
                  await openFullScreenIntentSettings();
                  checkFullScreen();
                }}
                last
              />
            </SettingsSection>
            <Text style={[styles.note, { color: c.textFaint }]}>
              {t('settings.notifFullScreenHint')}
            </Text>
          </>
        ) : null}

        {Platform.OS === 'android' && batteryExempt === false ? (
          <>
            <SettingsSection title={t('settings.notifReliability')}>
              <SettingsRow
                icon="battery-alert-variant-outline"
                label={t('settings.notifBatteryOpt')}
                onPress={async () => {
                  await requestIgnoreBatteryOptimizations();
                  checkBattery();
                }}
                last
              />
            </SettingsSection>
            <Text style={[styles.note, { color: c.textFaint }]}>
              {t('settings.notifBatteryOptHint')}
            </Text>
            <Pressable onPress={() => void openAppSettings()} hitSlop={8}>
              <Text style={[styles.link, { color: c.primary }]}>
                {t('settings.notifOpenAppSettings')}
              </Text>
            </Pressable>
          </>
        ) : null}

        <SettingsSection title={t('notifHistory.title')}>
          <SettingsRow
            icon="history"
            label={t('notifHistory.open')}
            description={t('notifHistory.openDesc')}
            onPress={() => navigation.navigate('NotificationHistory')}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifShow')}>
          <ToggleRow
            icon="message-badge-outline"
            label={t('settings.notifMessages')}
            description={t('settings.notifMessagesDesc')}
            storageKey="notif.messages"
          />
          <ToggleRow
            icon="phone-ring-outline"
            label={t('settings.notifCalls')}
            description={t('settings.notifCallsDesc')}
            storageKey="notif.calls"
          />
          <ToggleRow
            icon="circle-slice-8"
            label={t('settings.notifStories')}
            description={t('settings.notifStoriesDesc')}
            storageKey="notif.stories"
            defaultValue={false}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifAlert')}>
          <ToggleRow
            icon="volume-high"
            label={t('settings.notifSound')}
            description={t('settings.notifSoundDesc')}
            storageKey="notif.sound"
          />
          <ToggleRow
            icon="vibrate"
            label={t('settings.notifVibrate')}
            description={t('settings.notifVibrateDesc')}
            storageKey="notif.vibrate"
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.notifPreview')}>
          <ToggleRow
            icon="eye-outline"
            label={t('settings.notifShowPreview')}
            description={t('settings.notifShowPreviewDesc')}
            storageKey="notif.preview"
            last
          />
        </SettingsSection>

        {Platform.OS === 'android' ? (
          <>
            <SettingsSection title={t('settings.notifBackground')}>
              <SettingsRow
                icon="bell-cog-outline"
                label={t('settings.notifBackgroundHide')}
                description={t('settings.notifBackgroundHideDesc')}
                onPress={() => void openNotificationChannelSettings(KEEPALIVE_CHANNEL_ID)}
                last
              />
            </SettingsSection>
            <Text style={[styles.note, { color: c.textFaint }]}>
              {t('settings.notifBackgroundHint')}
            </Text>
          </>
        ) : null}

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.notifNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
  link: { fontSize: 13, fontWeight: '700', marginTop: 10, marginHorizontal: 6 },
});
