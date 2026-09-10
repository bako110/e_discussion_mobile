/**
 * Ajout de membres à un groupe / abonnés à une chaîne — sélection multiple
 * de contacts. En ligne obligatoire (le serveur doit résoudre les users).
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Button, Icon, Screen, showAlert, showToast } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService, userService } from '@/services';
import type { GroupMember, UserPublic } from '@/types';
import { withOnline } from '@/utils/online';

export const AddGroupMembersScreen: React.FC<MainScreenProps<'AddGroupMembers'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload: reloadGroups } = useGroups();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [contacts, setContacts] = useState<UserPublic[]>([]);
  const [existing, setExisting] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Record<string, UserPublic>>({});
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [list, mems] = await Promise.all([
          userService.contacts(),
          groupService.members(groupId).catch(() => [] as GroupMember[]),
        ]);
        if (!alive) return;
        setContacts(list);
        setExisting(new Set(mems.map((m) => m.user.id)));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [groupId]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return contacts
      .filter((u) => !existing.has(u.id))
      .filter((u) => {
        if (!q) return true;
        const n = (u.display_name || u.username || '').toLowerCase();
        return n.includes(q);
      });
  }, [contacts, existing, query]);

  const toggle = (u: UserPublic) =>
    setSelected((cur) => {
      const next = { ...cur };
      if (next[u.id]) delete next[u.id];
      else next[u.id] = u;
      return next;
    });

  const submit = async () => {
    const ids = Object.keys(selected);
    if (ids.length === 0) return;
    setBusy(true);
    try {
      const res = await withOnline(() => groupService.addMembers(groupId, ids));
      if (res === null) {
        setBusy(false);
        return; // hors-ligne : « connexion requise » déjà affiché
      }
      await reloadGroups();
      showToast(t('groups.membersAdded', { count: ids.length }));
      navigation.goBack();
    } catch {
      showAlert(t('errors.generic'));
      setBusy(false);
    }
  };

  const count = Object.keys(selected).length;

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('groups.addMembers')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      <View style={[styles.search, { backgroundColor: c.surfaceAlt }]}>
        <Icon name="magnify" size={18} color={c.textFaint} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('common.search')}
          placeholderTextColor={c.textFaint}
          style={[styles.searchInput, { color: c.text }]}
        />
      </View>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingBottom: 90 + insets.bottom }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textMuted }]}>
              {t('groups.noContactToAdd')}
            </Text>
          }
          renderItem={({ item }) => {
            const on = !!selected[item.id];
            const nm = item.display_name || item.username || '—';
            return (
              <Pressable
                onPress={() => toggle(item)}
                android_ripple={{ color: c.surfaceAlt }}
                style={styles.row}
              >
                <Avatar uri={item.avatar_url} name={nm} size={44} />
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {nm}
                </Text>
                <Icon
                  name={on ? 'check-circle' : 'circle-outline'}
                  size={22}
                  color={on ? c.primary : c.border}
                />
              </Pressable>
            );
          }}
        />
      )}

      {count > 0 ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 10, backgroundColor: c.card }]}>
          <Button
            label={t('groups.addN', { count })}
            onPress={submit}
            loading={busy}
          />
        </View>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginVertical: 10,
    paddingHorizontal: 12,
    height: 42,
    borderRadius: 21,
  },
  searchInput: { flex: 1, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  name: { flex: 1, fontSize: 15, fontWeight: '600' },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: 'rgba(140,150,170,0.2)',
  },
});
