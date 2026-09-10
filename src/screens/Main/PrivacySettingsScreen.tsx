import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showToast } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { userService } from '@/services';
import type { PrivacyField } from '@/services/userService';
import { openProfilePrivacySheet, privacyModeLabel } from '@/services/profilePrivacySheet';

/**
 * Confidentialité — façon WhatsApp actuel :
 *  - 4 champs (En ligne, Dernière connexion, Photo, Infos) avec 3 modes :
 *    Tout le monde / Tout le monde sauf… / Uniquement… (+ Personne, + « comme
 *    la dernière connexion » pour En ligne) ;
 *  - accusés de lecture (réciproques) ;
 *  - liste des utilisateurs bloqués.
 */
export const PrivacySettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me, refreshMeLocal } = useAuth();
  const c = theme.colors;

  const [busy, setBusy] = useState<string | null>(null);
  // ré-render quand le cache de confidentialité change
  const [tick, setTick] = useState(0);
  const bump = () => setTick((n) => n + 1);

  useEffect(() => {
    // charge l'état serveur au montage (best-effort)
    void userService.privacy().then(bump).catch(() => undefined);
  }, []);

  const openField = (field: PrivacyField) => openProfilePrivacySheet(field, bump);

  const toggleReadReceipts = async (next: boolean) => {
    setBusy('read_receipts');
    try {
      await userService.updateMe({ read_receipts: next });
      refreshMeLocal();
      showToast(t('settings.saved'));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const readReceipts = me?.read_receipts ?? true;
  // `tick` force la relecture des libellés depuis le cache
  void tick;

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
            icon="access-point"
            label={t('profilePrivacy.field_online')}
            value={privacyModeLabel('online')}
            onPress={() => openField('online')}
          />
          <SettingsRow
            icon="clock-outline"
            label={t('settings.lastSeen')}
            value={privacyModeLabel('last_seen')}
            onPress={() => openField('last_seen')}
          />
          <SettingsRow
            icon="account-box-outline"
            label={t('settings.profilePhoto')}
            value={privacyModeLabel('profile_photo')}
            onPress={() => openField('profile_photo')}
          />
          <SettingsRow
            icon="information-outline"
            label={t('settings.aboutVisibility')}
            value={privacyModeLabel('about')}
            onPress={() => openField('about')}
            last
          />
        </SettingsSection>

        <SettingsSection title={t('settings.messaging')}>
          <View style={[styles.toggleRow, { borderBottomColor: c.divider }]}>
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
