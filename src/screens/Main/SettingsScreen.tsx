import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { Avatar, AppHeader, Icon, Screen } from '@/components/common';
import { SettingsRow, SettingsSection } from '@/components/settings';
import { useAuth } from '@/context/AuthContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';

export const APP_VERSION = '1.0.0';

/**
 * Ecran Reglages : uniquement les GRANDS TITRES. Chaque ligne ouvre sa
 * propre page. Aucun reglage inline ici — tout est regroupe par sous-ecran.
 */
export const SettingsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const { pending } = useSync();
  const c = theme.colors;

  const name = me?.display_name || me?.username || '—';

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.title')}
        left={
          <Pressable
            onPress={() => navigation.navigate('Tabs', { screen: 'ChatsTab' })}
            hitSlop={12}
            style={styles.hdrBtn}
          >
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Carte profil -> Compte */}
        <Pressable
          style={[styles.profile, { backgroundColor: c.card, borderColor: c.border }]}
          android_ripple={{ color: c.surfaceAlt }}
          onPress={() => navigation.navigate('AccountSettings')}
        >
          <Avatar uri={me?.avatar_url} name={name} size={62} />
          <View style={styles.profileText}>
            <Text style={[styles.profileName, { color: c.text }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={{ color: c.textMuted }} numberOfLines={1}>
              {me?.about || me?.phone || t('settings.tapForAccount')}
            </Text>
          </View>
          <Icon name="chevron-right" size={22} color={c.textFaint} />
        </Pressable>

        {/* Grands titres */}
        <SettingsSection>
          <SettingsRow
            icon="account-circle-outline"
            label={t('settings.account')}
            onPress={() => navigation.navigate('AccountSettings')}
          />
          <SettingsRow
            icon="lock-outline"
            label={t('settings.privacy')}
            onPress={() => navigation.navigate('PrivacySettings')}
          />
          <SettingsRow
            icon="chat-outline"
            label={t('settings.chats')}
            onPress={() => navigation.navigate('ChatsSettings')}
          />
          <SettingsRow
            icon="phone-outline"
            label={t('settings.calls')}
            onPress={() => navigation.navigate('CallsSettings')}
          />
          <SettingsRow
            icon="bell-outline"
            label={t('settings.notifications')}
            onPress={() => navigation.navigate('NotificationsSettings')}
          />
          <SettingsRow
            icon="palette-outline"
            label={t('settings.appearance')}
            onPress={() => navigation.navigate('AppearanceSettings')}
          />
          <SettingsRow
            icon="database-outline"
            label={t('settings.data')}
            value={pending > 0 ? String(pending) : undefined}
            onPress={() => navigation.navigate('StorageSettings')}
            last
          />
        </SettingsSection>

        <SettingsSection>
          <SettingsRow
            icon="help-circle-outline"
            label={t('settings.help')}
            onPress={() => navigation.navigate('HelpSettings')}
          />
          <SettingsRow
            icon="information-outline"
            label={t('settings.about')}
            onPress={() => navigation.navigate('AboutSettings')}
            last
          />
        </SettingsSection>

        <Text style={[styles.footer, { color: c.textFaint }]}>
          {t('settings.madeWith')} · v{APP_VERSION}
        </Text>
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
  footer: { textAlign: 'center', fontSize: 12, marginTop: 20 },
});
