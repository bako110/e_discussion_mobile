import React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { SettingsRow, SettingsSection, ToggleRow } from '@/components/settings';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { getDb } from '@/db';
import type { MainNav } from '@/navigation/types';
import { resetSyncCursor } from '@/sync/syncEngine';

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { pending, online, syncNow } = useSync();
  const c = theme.colors;

  const clearLocal = () => {
    showAlert(t('settings.clearLocal'), t('settings.clearLocalConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          const db = getDb();
          await db.execute('DELETE FROM messages');
          await db.execute('DELETE FROM conversations');
          await db.execute('DELETE FROM outbox');
          await resetSyncCursor();
          await syncNow();
        },
      },
    ]);
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.data')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SettingsSection title={t('settings.sync')}>
          <SettingsRow
            icon={online ? 'cloud-check-outline' : 'cloud-off-outline'}
            label={t('settings.connection')}
            value={online ? t('common.online') : t('common.offline')}
            chevron={false}
          />
          <SettingsRow
            icon="tray-full"
            label={t('settings.pendingActions')}
            value={String(pending)}
            chevron={false}
          />
          <SettingsRow
            icon="sync"
            label={t('settings.syncNow')}
            onPress={() => void syncNow()}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.network')}>
          <ToggleRow
            icon="wifi"
            label={t('settings.autoDownloadWifi')}
            storageKey="storage.autoDownloadWifi"
          />
          <ToggleRow
            icon="cellphone"
            label={t('settings.autoDownloadData')}
            storageKey="storage.autoDownloadData"
            defaultValue={false}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.manage')}>
          <SettingsRow
            icon="delete-sweep-outline"
            label={t('settings.clearLocal')}
            onPress={clearLocal}
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.storageNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
