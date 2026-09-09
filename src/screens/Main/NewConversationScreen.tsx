import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showAlert, showSheet } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import {
  conversationService,
  hasContactsPermission,
  neverSyncedContacts,
  syncPhoneContacts,
  userService,
} from '@/services';
import type { UserPublic } from '@/types';

export const NewConversationScreen: React.FC<MainScreenProps<'NewConversation'>> = ({
  navigation,
  route,
}) => {
  const mode = route.params?.mode ?? 'chat';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { online } = useSync();
  const { me } = useAuth();
  const { available: callsAvailable, startCall: placeCall, phase: callPhase } = useCall();
  const c = theme.colors;

  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<UserPublic[]>([]);
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [remoteResults, setRemoteResults] = useState<UserPublic[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [syncingContacts, setSyncingContacts] = useState(false);
  const [permBlocked, setPermBlocked] = useState(false);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadContacts = useCallback(async () => {
    try {
      setContacts(await userService.contacts());
    } catch {
      setContacts([]);
    } finally {
      setLoadingContacts(false);
    }
  }, []);

  /** Synchronise le carnet du téléphone puis recharge la liste serveur. */
  const runContactSync = useCallback(
    async (askPermission: boolean) => {
      if (syncingContacts) return;
      setSyncingContacts(true);
      try {
        const res = await syncPhoneContacts({
          userPhone: me?.phone ?? null,
          askPermission,
        });
        setPermBlocked(res.permission === 'blocked' || res.permission === 'denied');
        await loadContacts();
      } catch {
        /* best-effort */
      } finally {
        setSyncingContacts(false);
      }
    },
    [syncingContacts, me?.phone, loadContacts],
  );

  // Au montage : affiche la liste connue, puis synchronise le carnet
  // (permission demandée si jamais faite, sinon seulement si déjà accordée).
  useEffect(() => {
    let alive = true;
    (async () => {
      await loadContacts();
      if (!alive) return;
      const granted = await hasContactsPermission();
      if (granted || neverSyncedContacts()) {
        await runContactSync(neverSyncedContacts());
      } else {
        setPermBlocked(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Filtre local sur les contacts.
  const filteredContacts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((u) => {
      const name = (u.display_name || u.username || '').toLowerCase();
      return name.includes(q) || (u.username ?? '').toLowerCase().includes(q);
    });
  }, [contacts, query]);

  // Recherche serveur (personnes hors de mes contacts) si la requete est
  // significative et ne matche aucun contact local.
  useEffect(() => {
    if (debounce.current) clearTimeout(debounce.current);
    const q = query.trim();
    if (q.length < 2) {
      setRemoteResults([]);
      return;
    }
    debounce.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await userService.search(q);
        const contactIds = new Set(contacts.map((u) => u.id));
        setRemoteResults(res.filter((u) => !contactIds.has(u.id)));
      } catch {
        setRemoteResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, [query, contacts]);

  const openChat = useCallback(
    async (user: UserPublic) => {
      if (busy) return;
      setBusy(true);
      try {
        const detail = await conversationService.start(user.id);
        navigation.replace('Chat', {
          conversationId: detail.id,
          partnerId: user.id,
          partnerName: user.display_name || user.username || '—',
          partnerAvatar: user.avatar_url,
        });
      } finally {
        setBusy(false);
      }
    },
    [busy, navigation],
  );

  const startCall = useCallback(
    (user: UserPublic) => {
      if (!callsAvailable) {
        showAlert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
        return;
      }
      if (callPhase !== 'idle') return;
      showSheet({
        title: user.display_name || user.username || '—',
        actions: [
          {
            label: t('calls.voice'),
            icon: 'phone',
            onPress: () => {
              navigation.goBack();
              placeCall(user, 'voice').catch(() => undefined);
            },
          },
          {
            label: t('calls.video'),
            icon: 'video',
            onPress: () => {
              navigation.goBack();
              placeCall(user, 'video').catch(() => undefined);
            },
          },
        ],
      });
    },
    [callsAvailable, callPhase, placeCall, navigation, t],
  );

  const onPick = (user: UserPublic) => (mode === 'call' ? startCall(user) : openChat(user));

  const headerTitle = mode === 'call' ? t('calls.newCall') : t('conversations.newChat');

  const renderUser = (item: UserPublic) => {
    const name = item.display_name || item.username || '—';
    return (
      <Pressable
        style={styles.row}
        android_ripple={{ color: c.surfaceAlt }}
        onPress={() => onPick(item)}
      >
        <Avatar uri={item.avatar_url} name={name} size={46} online={item.is_online} />
        <View style={styles.rowBody}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {name}
          </Text>
          {item.username ? (
            <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
              @{item.username}
            </Text>
          ) : null}
        </View>
        <Icon
          name={mode === 'call' ? 'phone-outline' : 'chevron-right'}
          size={mode === 'call' ? 20 : 22}
          color={mode === 'call' ? c.primary : c.textFaint}
        />
      </Pressable>
    );
  };

  const showRemote = query.trim().length >= 2 && remoteResults.length > 0;

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={headerTitle}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
        right={
          <Pressable
            onPress={() => void runContactSync(true)}
            hitSlop={10}
            disabled={syncingContacts}
          >
            {syncingContacts ? (
              <ActivityIndicator size="small" color={c.primary} />
            ) : (
              <Icon name="sync" size={22} color={c.primary} />
            )}
          </Pressable>
        }
      />

      <View style={styles.searchWrap}>
        <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
          <Icon name="magnify" size={20} color={c.textFaint} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('common.search')}
            placeholderTextColor={c.textFaint}
            autoCapitalize="none"
            style={[styles.input, { color: c.text }]}
          />
          {searching ? <ActivityIndicator size="small" color={c.primary} /> : null}
        </View>
        {!online ? (
          <Text style={[styles.offline, { color: c.textFaint }]}>{t('sync.offline')}</Text>
        ) : null}
      </View>

      {syncingContacts ? (
        <View style={[styles.syncBanner, { backgroundColor: c.surfaceAlt }]}>
          <ActivityIndicator size="small" color={c.primary} />
          <Text style={[styles.syncBannerText, { color: c.textMuted }]}>
            {t('contacts.syncing')}
          </Text>
        </View>
      ) : permBlocked ? (
        <Pressable
          onPress={() => void runContactSync(true)}
          style={[styles.syncBanner, { backgroundColor: c.surfaceAlt }]}
        >
          <Icon name="contacts-outline" size={18} color={c.primary} />
          <Text style={[styles.syncBannerText, { color: c.text }]}>
            {t('contacts.enableToFind')}
          </Text>
          <Icon name="chevron-right" size={18} color={c.textMuted} />
        </Pressable>
      ) : null}

      {loadingContacts ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={filteredContacts}
          keyExtractor={(u) => u.id}
          keyboardShouldPersistTaps="handled"
          contentContainerStyle={filteredContacts.length === 0 ? styles.emptyWrap : undefined}
          ListHeaderComponent={
            <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
              {t('conversations.myContacts')}
            </Text>
          }
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
          renderItem={({ item }) => renderUser(item)}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="account-multiple-outline" size={34} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {t('conversations.noContacts')}
              </Text>
              <Text style={[styles.emptyHint, { color: c.textMuted }]}>
                {t('conversations.searchToStart')}
              </Text>
            </View>
          }
          ListFooterComponent={
            showRemote ? (
              <View>
                <Text style={[styles.sectionTitle, { color: c.textMuted }]}>
                  {t('conversations.otherResults')}
                </Text>
                {remoteResults.map((u) => (
                  <View key={u.id}>
                    {renderUser(u)}
                    <View style={[styles.sep, { backgroundColor: c.divider }]} />
                  </View>
                ))}
              </View>
            ) : null
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 46,
    borderRadius: 23,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  input: { flex: 1, fontSize: 15 },
  offline: { fontSize: 12, marginTop: 6, marginLeft: 8 },
  syncBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  syncBannerText: { flex: 1, fontSize: 13, fontWeight: '500' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 14,
    marginBottom: 6,
    marginLeft: 18,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowBody: { flex: 1 },
  name: { fontSize: 16, fontWeight: '700' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 74 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40, paddingTop: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
});
