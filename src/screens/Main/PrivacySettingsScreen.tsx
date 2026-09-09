import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert, showSheet } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { userService } from '@/services';
import type { PrivacyLevel } from '@/types';

const LEVELS: PrivacyLevel[] = ['everyone', 'contacts', 'nobody'];

/**
 * Confidentialité — réglages branchés au backend :
 *  - qui voit ma dernière connexion / ma photo / mes infos (everyone/contacts/nobody) ;
 *  - accusés de lecture (si off, je n'envoie ni ne reçois les « vu ») ;
 *  - accès à la liste des utilisateurs bloqués.
 */
export const PrivacySettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me, refreshMe } = useAuth();
  const c = theme.colors;

  const [busy, setBusy] = useState<string | null>(null);

  const levelLabel = (lvl: PrivacyLevel) => t(`settings.privacy_${lvl}`);

  const LEVEL_ICON: Record<PrivacyLevel, string> = {
    everyone: 'earth',
    contacts: 'account-multiple-outline',
    nobody: 'lock-outline',
  };

  const pickLevel = (
    key: 'last_seen_privacy' | 'profile_photo_privacy' | 'about_privacy',
    current: PrivacyLevel,
    title: string,
  ) => {
    showSheet({
      title,
      actions: LEVELS.map((lvl) => ({
        label: levelLabel(lvl) + (lvl === current ? '  ✓' : ''),
        icon: LEVEL_ICON[lvl],
        onPress: async () => {
          if (lvl === current) return;
          setBusy(key);
          try {
            await userService.setPrivacy(key, lvl);
            await refreshMe();
          } catch {
            showAlert(t('errors.generic'));
          } finally {
            setBusy(null);
          }
        },
      })),
    });
  };

  const toggleReadReceipts = async (next: boolean) => {
    setBusy('read_receipts');
    try {
      await userService.updateMe({ read_receipts: next });
      await refreshMe();
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  };

  const lastSeen = me?.last_seen_privacy ?? 'everyone';
  const photo = me?.profile_photo_privacy ?? 'everyone';
  const about = me?.about_privacy ?? 'everyone';
  const readReceipts = me?.read_receipts ?? true;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.privacy')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <SettingsSection title={t('settings.whoCanSee')}>
          <SettingsRow
            icon="clock-outline"
            label={t('settings.lastSeen')}
            value={busy === 'last_seen_privacy' ? '…' : levelLabel(lastSeen)}
            onPress={() =>
              pickLevel('last_seen_privacy', lastSeen, t('settings.lastSeen'))
            }
          />
          <SettingsRow
            icon="account-box-outline"
            label={t('settings.profilePhoto')}
            value={busy === 'profile_photo_privacy' ? '…' : levelLabel(photo)}
            onPress={() =>
              pickLevel('profile_photo_privacy', photo, t('settings.profilePhoto'))
            }
          />
          <SettingsRow
            icon="information-outline"
            label={t('settings.aboutVisibility')}
            value={busy === 'about_privacy' ? '…' : levelLabel(about)}
            onPress={() =>
              pickLevel('about_privacy', about, t('settings.aboutVisibility'))
            }
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.messaging')}>
          <View
            style={[styles.toggleRow, { borderBottomColor: c.divider }]}
          >
            <Icon name="check-all" size={20} color={c.textMuted} />
            <Text style={[styles.toggleLabel, { color: c.text }]}>
              {t('settings.readReceipts')}
            </Text>
            <Switch
              value={readReceipts}
              onValueChange={toggleReadReceipts}
              disabled={busy === 'read_receipts'}
              trackColor={{ true: c.primary, false: c.border }}
              thumbColor="#fff"
            />
          </View>
          <SettingsRow
            icon="account-cancel-outline"
            label={t('settings.blockedUsers')}
            onPress={() => navigation.navigate('BlockedUsers')}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.encryption')}>
          <SettingsRow
            icon="shield-lock-outline"
            label={t('settings.encryptionStatus')}
            value={t('settings.encryptionOn')}
            chevron={false}
          />
          <SettingsRow
            icon="cellphone-link"
            label={t('settings.linkedDevices')}
            onPress={() => navigation.navigate('Devices')}
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>
          {readReceipts ? t('settings.privacyNote') : t('settings.readReceiptsOffNote')}
        </Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  toggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    minHeight: 52,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  toggleLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
