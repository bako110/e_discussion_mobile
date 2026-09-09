import React, { useEffect, useState } from 'react';
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
import { mediaCache } from '@/services/mediaCache';
import { storage } from '@/utils/storage';
import { resetSyncCursor } from '@/sync/syncEngine';

function humanSize(bytes: number): string {
  if (bytes <= 0) return '0 o';
  const u = ['o', 'Ko', 'Mo', 'Go'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export const StorageSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { pending, online, syncNow } = useSync();
  const c = theme.colors;

  const [cacheSize, setCacheSize] = useState<number | null>(null);
  const refreshCacheSize = () => void mediaCache.size().then(setCacheSize);
  useEffect(refreshCacheSize, []);

  const clearMediaCache = () => {
    showAlert(t('settings.clearMediaCache'), t('settings.clearMediaCacheConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'),
        style: 'destructive',
        onPress: async () => {
          await mediaCache.clear();
          refreshCacheSize();
        },
      },
    ]);
  };

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
          await db.execute('DELETE FROM group_messages');
          await db.execute('DELETE FROM groups');
          await db.execute('DELETE FROM outbox');
          await mediaCache.clear();
          try {
            storage.delete('stories.feed.cache');
            storage.delete('stories.mine.cache');
          } catch {
            /* stockage indispo */
          }
          await resetSyncCursor();
          await syncNow();
          refreshCacheSize();
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
            icon="image-off-outline"
            label={t('settings.clearMediaCache')}
            value={cacheSize == null ? '…' : humanSize(cacheSize)}
            onPress={clearMediaCache}
          />
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
