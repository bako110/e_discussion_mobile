import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showAlert } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import {
  conversationService,
  hasContactsPermission,
  lastContactsSyncAt,
  syncPhoneContacts,
  type ContactSyncResult,
} from '@/services';
import type { ContactMatch } from '@/types';
import { relativeTime } from '@/utils/time';

/**
 * « Synchroniser mes contacts » — lit le carnet du téléphone, envoie les
 * numéros au serveur et affiche ceux qui utilisent déjà Gofolyx. Aucun numéro
 * qui ne correspond pas à un compte n'est conservé côté serveur.
 */
export const ContactSyncScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const c = theme.colors;

  const [granted, setGranted] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ContactSyncResult | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(lastContactsSyncAt());

  useEffect(() => {
    void hasContactsPermission().then(setGranted);
  }, []);

  const runSync = useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const r = await syncPhoneContacts({ userPhone: me?.phone ?? null });
      setResult(r);
      setGranted(r.permission === 'granted');
      setLastAt(lastContactsSyncAt());
      if (r.permission === 'blocked') {
        showAlert(t('contacts.permBlockedTitle'), t('contacts.permBlockedBody'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('settings.openSettings'), onPress: () => Linking.openSettings() },
        ]);
      }
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setRunning(false);
    }
  }, [running, me?.phone, t]);

  const [opening, setOpening] = useState<string | null>(null);
  const openChat = async (m: ContactMatch) => {
    if (!m.user || opening) return;
    setOpening(m.phone);
    try {
      const detail = await conversationService.start(m.user.id);
      navigation.navigate('Chat', {
        conversationId: detail.id,
        partnerId: m.user.id,
        partnerName: m.user.display_name || m.user.username || m.phone,
        partnerAvatar: m.user.avatar_url,
      });
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setOpening(null);
    }
  };

  const matches = result?.matches ?? [];

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('contacts.syncTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.hero, { backgroundColor: c.surfaceAlt }]}>
          <View style={[styles.heroIcon, { backgroundColor: c.primary }]}>
            <Icon name="contacts-outline" size={26} color="#fff" />
          </View>
          <Text style={[styles.heroText, { color: c.text }]}>
            {t('contacts.syncExplain')}
          </Text>
          {lastAt ? (
            <Text style={[styles.lastSync, { color: c.textMuted }]}>
              {t('contacts.lastSync', { when: relativeTime(new Date(lastAt).toISOString()) })}
            </Text>
          ) : null}
        </View>

        <Pressable
          onPress={runSync}
          disabled={running}
          style={[styles.syncBtn, { backgroundColor: c.primary, opacity: running ? 0.7 : 1 }]}
        >
          {running ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="sync" size={18} color="#fff" />
              <Text style={styles.syncBtnText}>
                {lastAt ? t('contacts.resync') : t('contacts.syncNow')}
              </Text>
            </>
          )}
        </Pressable>

        {granted === false ? (
          <Text style={[styles.permNote, { color: c.textMuted }]}>
            {t('contacts.permNeeded')}
          </Text>
        ) : null}

        {result ? (
          <>
            <Text style={[styles.section, { color: c.textMuted }]}>
              {t('contacts.foundCount', { count: matches.length })} ·{' '}
              {t('contacts.scannedCount', { count: result.scanned })}
            </Text>

            {matches.length === 0 ? (
              <View style={styles.empty}>
                <Icon name="account-search-outline" size={30} color={c.textFaint} />
                <Text style={[styles.emptyText, { color: c.textMuted }]}>
                  {t('contacts.noneOnApp')}
                </Text>
              </View>
            ) : (
              matches.map((m) => {
                const name =
                  m.user?.display_name || m.display_name || m.user?.username || m.phone;
                return (
                  <Pressable
                    key={m.phone}
                    style={styles.row}
                    android_ripple={{ color: c.surfaceAlt }}
                    onPress={() => openChat(m)}
                  >
                    <Avatar uri={m.user?.avatar_url} name={name} size={44} />
                    <View style={styles.rowBody}>
                      <Text style={[styles.rowName, { color: c.text }]} numberOfLines={1}>
                        {name}
                      </Text>
                      <Text style={[styles.rowSub, { color: c.textMuted }]} numberOfLines={1}>
                        {m.user?.username ? `@${m.user.username}` : m.phone}
                      </Text>
                    </View>
                    {opening === m.phone ? (
                      <ActivityIndicator size="small" color={c.primary} />
                    ) : (
                      <Icon name="message-outline" size={20} color={c.primary} />
                    )}
                  </Pressable>
                );
              })
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  hero: { borderRadius: 16, padding: 18, alignItems: 'center', gap: 10 },
  heroIcon: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  heroText: { fontSize: 14, textAlign: 'center', lineHeight: 20 },
  lastSync: { fontSize: 12 },
  syncBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 14,
    borderRadius: 24,
  },
  syncBtnText: { color: '#fff', fontWeight: '800', fontSize: 15 },
  permNote: { fontSize: 12, textAlign: 'center', marginTop: 10, lineHeight: 17 },
  section: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  rowBody: { flex: 1 },
  rowName: { fontSize: 15, fontWeight: '700' },
  rowSub: { fontSize: 13, marginTop: 1 },
  empty: { alignItems: 'center', gap: 10, paddingVertical: 40 },
  emptyText: { fontSize: 14, textAlign: 'center' },
});
