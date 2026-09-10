import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showAlert } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { authService } from '@/services';
import { E2EE_ENABLED } from '@/utils/constants';

/**
 * Sous-ecran "Compte" : profil, identifiants lies (email / telephone),
 * elements de confidentialite lies au compte. Accessible depuis Reglages.
 */
export const AccountSettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me, signOut } = useAuth();
  const c = theme.colors;
  const [busy, setBusy] = useState<'export' | 'delete' | null>(null);

  const name = me?.display_name || me?.username || '—';

  const exportData = async () => {
    if (busy) return;
    setBusy('export');
    try {
      const data = await authService.exportMyData();
      await Share.share({
        message: JSON.stringify(data, null, 2),
        title: t('settings.exportTitle'),
      });
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setBusy(null);
    }
  };

  const confirmDelete = () => {
    showAlert(t('settings.deleteAccount'), t('settings.deleteAccountWarn'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.continue'),
        style: 'destructive',
        onPress: () => {
          // 2e confirmation
          showAlert(t('settings.deleteAccountConfirmTitle'), t('settings.deleteAccountConfirmBody'), [
            { text: t('common.cancel'), style: 'cancel' },
            {
              text: t('settings.deleteAccount'),
              style: 'destructive',
              onPress: async () => {
                setBusy('delete');
                try {
                  await authService.deleteAccount();
                  await signOut();
                } catch {
                  setBusy(null);
                  showAlert(t('errors.generic'));
                }
              },
            },
          ]);
        },
      },
    ]);
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.account')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Profil */}
        <Pressable
          style={[styles.profile, { backgroundColor: c.card, borderColor: c.border }]}
          android_ripple={{ color: c.surfaceAlt }}
          onPress={() => navigation.navigate('EditProfile')}
        >
          <Avatar uri={me?.avatar_url} name={name} size={64} />
          <View style={styles.profileText}>
            <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
              {name}
            </Text>
            {me?.username ? (
              <Text style={{ color: c.textMuted }} numberOfLines={1}>
                @{me.username}
              </Text>
            ) : null}
            {me?.about ? (
              <Text style={{ color: c.textFaint, fontSize: 13, marginTop: 2 }} numberOfLines={1}>
                {me.about}
              </Text>
            ) : null}
          </View>
          <Icon name="pencil-outline" size={20} color={c.primary} />
        </Pressable>

        {/* Identifiants */}
        <SettingsSection title={t('settings.identifiers')}>
          <SettingsRow
            icon="account-outline"
            label={t('settings.username')}
            value={me?.username ? `@${me.username}` : '—'}
            onPress={() => navigation.navigate('EditProfile')}
          />
          <SettingsRow
            icon="phone-outline"
            label={t('settings.linkedPhone')}
            value={me?.phone ?? t('settings.notLinked')}
            onPress={() => navigation.navigate('LinkIdentifier', { kind: 'phone' })}
          />
          <SettingsRow
            icon="email-outline"
            label={t('settings.linkedEmail')}
            value={me?.email ?? t('settings.notLinked')}
            onPress={() => navigation.navigate('LinkIdentifier', { kind: 'email' })}
            last
          />
        </SettingsSection>

        {/* Confidentialite du compte */}
        <SettingsSection title={t('settings.privacy')}>
          <SettingsRow
            icon="lock-check-outline"
            label={t('settings.privacyControls')}
            onPress={() => navigation.navigate('PrivacySettings')}
          />
          <SettingsRow
            icon="cellphone-link"
            label={t('settings.linkedDevices')}
            onPress={() => navigation.navigate('Devices')}
          />
          <SettingsRow
            icon="account-multiple-check-outline"
            label={t('contacts.syncTitle')}
            onPress={() => navigation.navigate('ContactSync')}
          />
          {E2EE_ENABLED ? (
            <SettingsRow
              icon="shield-key-outline"
              label={t('settings.encryption')}
              value={t('settings.encryptionOn')}
              last
            />
          ) : null}
        </SettingsSection>

        {/* Données & compte */}
        <SettingsSection title={t('settings.dataAndAccount')}>
          <SettingsRow
            icon="download-outline"
            label={busy === 'export' ? t('common.loading') : t('settings.exportData')}
            onPress={exportData}
          />
          <SettingsRow
            icon="delete-outline"
            label={t('settings.deleteAccount')}
            onPress={confirmDelete}
            danger
            last
          />
        </SettingsSection>

        <Text style={[styles.note, { color: c.textFaint }]}>{t('settings.accountNote')}</Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    padding: 14,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    marginTop: 4,
  },
  profileText: { flex: 1 },
  profileName: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  note: { fontSize: 12, marginTop: 18, marginHorizontal: 6, lineHeight: 17 },
});
