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

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService, userService } from '@/services';
import type { GroupKind, UserPublic } from '@/types';
import { withOnline } from '@/utils/online';

/**
 * Création d'un groupe ou d'une chaîne.
 *
 * `route.params.kind` fixe le type par défaut (bascule possible en tête).
 * Étape unique : nom + description + sélection de membres (contacts). La
 * publication renvoie vers le chat du groupe créé.
 */
export const CreateGroupScreen: React.FC<MainScreenProps<'CreateGroup'>> = ({
  navigation,
  route,
}) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { reload } = useGroups();
  const picker = useMediaPicker();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [kind, setKind] = useState<GroupKind>(route.params?.kind ?? 'group');
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [query, setQuery] = useState('');
  const [contacts, setContacts] = useState<UserPublic[]>([]);
  const [selected, setSelected] = useState<Record<string, UserPublic>>({});
  const [loadingContacts, setLoadingContacts] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await userService.contacts();
        if (alive) setContacts(list);
      } catch {
        if (alive) setContacts([]);
      } finally {
        if (alive) setLoadingContacts(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return contacts;
    return contacts.filter((u) =>
      (u.display_name || u.username || '').toLowerCase().includes(q),
    );
  }, [contacts, query]);

  const selCount = Object.keys(selected).length;

  const toggle = (u: UserPublic) =>
    setSelected((prev) => {
      const next = { ...prev };
      if (next[u.id]) delete next[u.id];
      else next[u.id] = u;
      return next;
    });

  const pickAvatar = async () => {
    // recadrage circulaire local AVANT upload
    const up = await picker.pickAvatar();
    if (up) setAvatarUrl(up.url);
  };

  const submit = async () => {
    const n = name.trim();
    if (!n || busy) return;
    setBusy(true);
    setError(null);
    try {
      const group = await withOnline(() =>
        groupService.create({
          kind,
          name: n,
          description: description.trim() || undefined,
          avatar_url: avatarUrl ?? undefined,
          member_ids: Object.keys(selected),
        }),
      );
      if (!group) {
        setBusy(false);
        return; // hors-ligne : "connexion requise" déjà affiché
      }
      await reload();
      navigation.replace('GroupChat', { groupId: group.id, name: group.name });
    } catch (e) {
      console.warn('[group] create failed:', e);
      setError(t('errors.generic'));
      setBusy(false);
    }
  };

  const renderContact = ({ item }: { item: UserPublic }) => {
    const nm = item.display_name || item.username || '—';
    const on = !!selected[item.id];
    return (
      <Pressable
        style={styles.row}
        android_ripple={{ color: c.surfaceAlt }}
        onPress={() => toggle(item)}
      >
        <Avatar uri={item.avatar_url} name={nm} size={44} online={item.is_online} />
        <View style={styles.rowBody}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {nm}
          </Text>
          {item.username ? (
            <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
              @{item.username}
            </Text>
          ) : null}
        </View>
        <View
          style={[
            styles.check,
            { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent' },
          ]}
        >
          {on ? <Icon name="check" size={14} color="#fff" /> : null}
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={kind === 'channel' ? t('groups.newChannel') : t('groups.newGroup')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      <FlatList
        data={loadingContacts ? [] : filtered}
        keyExtractor={(u) => u.id}
        keyboardShouldPersistTaps="handled"
        renderItem={renderContact}
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
        ListHeaderComponent={
          <View>
            {/* avatar */}
            <View style={styles.avatarRow}>
              <Pressable onPress={pickAvatar} disabled={picker.busy}>
                <Avatar uri={avatarUrl} name={name || '?'} size={72} />
                <View style={[styles.avatarBadge, { backgroundColor: c.primary, borderColor: c.background }]}>
                  {picker.busy ? (
                    <ActivityIndicator color="#fff" size="small" />
                  ) : (
                    <Icon name="camera" size={13} color="#fff" />
                  )}
                </View>
              </Pressable>
            </View>

            {/* bascule type */}
            <View style={styles.kindRow}>
              {(['group', 'channel'] as GroupKind[]).map((k) => (
                <Pressable
                  key={k}
                  onPress={() => setKind(k)}
                  style={[
                    styles.kindBtn,
                    { borderColor: kind === k ? c.primary : c.border },
                    kind === k && { backgroundColor: c.surfaceAlt },
                  ]}
                >
                  <Icon
                    name={k === 'group' ? 'account-multiple' : 'bullhorn'}
                    size={18}
                    color={kind === k ? c.primary : c.textMuted}
                  />
                  <Text
                    style={[
                      styles.kindText,
                      { color: kind === k ? c.primary : c.textMuted },
                    ]}
                  >
                    {k === 'group' ? t('groups.group') : t('groups.channel')}
                  </Text>
                </Pressable>
              ))}
            </View>

            {/* nom */}
            <View style={[styles.field, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="pencil-outline" size={18} color={c.textFaint} />
              <TextInput
                value={name}
                onChangeText={setName}
                placeholder={
                  kind === 'channel' ? t('groups.channelNamePlaceholder') : t('groups.groupNamePlaceholder')
                }
                placeholderTextColor={c.textFaint}
                maxLength={120}
                style={[styles.input, { color: c.text }]}
              />
            </View>

            {/* description */}
            <View style={[styles.field, { backgroundColor: c.surface, borderColor: c.border }]}>
              <Icon name="text" size={18} color={c.textFaint} />
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder={t('groups.descriptionPlaceholder')}
                placeholderTextColor={c.textFaint}
                maxLength={2000}
                multiline
                style={[styles.input, { color: c.text, minHeight: 40 }]}
              />
            </View>

            {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

            <View style={styles.searchWrap}>
              <View style={[styles.search, { backgroundColor: c.surface, borderColor: c.border }]}>
                <Icon name="magnify" size={19} color={c.textFaint} />
                <TextInput
                  value={query}
                  onChangeText={setQuery}
                  placeholder={t('groups.addMembers')}
                  placeholderTextColor={c.textFaint}
                  autoCapitalize="none"
                  style={[styles.input, { color: c.text }]}
                />
              </View>
              <Text style={[styles.selHint, { color: c.textMuted }]}>
                {t('groups.membersSelected', { count: selCount })}
              </Text>
            </View>
          </View>
        }
        ListEmptyComponent={
          loadingContacts ? (
            <View style={styles.center}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : (
            <Text style={[styles.emptyText, { color: c.textMuted }]}>
              {t('conversations.noContacts')}
            </Text>
          )
        }
        contentContainerStyle={{ paddingBottom: 100 }}
      />

      {/* bouton créer */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom, backgroundColor: c.background, borderTopColor: c.divider }]}>
        <Pressable
          onPress={submit}
          disabled={!name.trim() || busy}
          style={[styles.createBtn, { backgroundColor: c.primary, opacity: name.trim() && !busy ? 1 : 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Icon name="check" size={18} color="#fff" />
              <Text style={styles.createText}>
                {kind === 'channel' ? t('groups.createChannel') : t('groups.createGroup')}
              </Text>
            </>
          )}
        </Pressable>
      </View>
    </Screen>
  );
};

const styles = StyleSheet.create({
  avatarRow: { alignItems: 'center', paddingTop: 16 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  kindRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 14 },
  kindBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: 14,
    borderWidth: 1.5,
  },
  kindText: { fontSize: 14, fontWeight: '700' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginTop: 12,
    borderRadius: 14,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  input: { flex: 1, fontSize: 15 },
  error: { fontSize: 13, marginHorizontal: 18, marginTop: 8, fontWeight: '600' },
  searchWrap: { paddingHorizontal: 16, paddingTop: 16 },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  selHint: { fontSize: 12, marginTop: 8, marginLeft: 6, fontWeight: '600' },
  center: { paddingVertical: 40, alignItems: 'center' },
  emptyText: { textAlign: 'center', paddingVertical: 30, fontSize: 14 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 11 },
  rowBody: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  createBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    borderRadius: 24,
  },
  createText: { color: '#fff', fontWeight: '800', fontSize: 15 },
});
