/**
 * Sélection multiple de contacts — écran générique réutilisable.
 *
 * On l'ouvre via `selectContacts()` (pont impératif à base de token, comme
 * `openCrop`) : la promesse résout la liste d'ids choisis, ou `null` si retour.
 *
 *   const ids = await selectContacts({ title: 'Masquer à…', preselected });
 */
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import { navigationRef } from '@/navigation/navigationRef';
import type { MainScreenProps } from '@/navigation/types';
import { userService } from '@/services';
import type { UserPublic } from '@/types';

// ── pont impératif <-> écran ────────────────────────────────────────────
const _pending = new Map<string, (ids: string[] | null) => void>();
let _seq = 0;

export function selectContacts(opts: {
  title?: string;
  preselected?: string[];
  confirmLabel?: string;
}): Promise<string[] | null> {
  return new Promise((resolve) => {
    if (!navigationRef.isReady()) {
      resolve(null);
      return;
    }
    const token = `selc_${Date.now()}_${_seq++}`;
    _pending.set(token, resolve);
    navigationRef.navigate('SelectContacts', {
      token,
      title: opts.title,
      preselected: opts.preselected,
      confirmLabel: opts.confirmLabel,
    });
  });
}

function resolvePick(token: string, ids: string[] | null): void {
  const fn = _pending.get(token);
  if (fn) {
    _pending.delete(token);
    fn(ids);
  }
}

export const SelectContactsScreen: React.FC<MainScreenProps<'SelectContacts'>> = ({
  route,
  navigation,
}) => {
  const { token, title, preselected, confirmLabel } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [contacts, setContacts] = useState<UserPublic[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set(preselected ?? []));
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);

  const answered = useRef(false);
  const answer = useCallback(
    (ids: string[] | null) => {
      if (answered.current) return;
      answered.current = true;
      resolvePick(token, ids);
    },
    [token],
  );
  useEffect(() => navigation.addListener('beforeRemove', () => answer(null)), [navigation, answer]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await userService.contacts();
        if (alive) setContacts(list);
      } finally {
        if (alive) setLoading(false);
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

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const confirm = () => {
    answer([...selected]);
    navigation.goBack();
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={title ?? t('storyPrivacy.selectTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
        right={
          <Pressable onPress={confirm} hitSlop={12} style={styles.hdrBtn}>
            <Text style={[styles.done, { color: c.onHeader }]}>
              {confirmLabel ?? t('common.done')}
            </Text>
          </Pressable>
        }
      />

      <View style={[styles.search, { backgroundColor: c.surfaceAlt }]}>
        <Icon name="magnify" size={18} color={c.textMuted} />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder={t('common.search')}
          placeholderTextColor={c.textMuted}
          style={[styles.searchInput, { color: c.text }]}
        />
      </View>

      {selected.size > 0 ? (
        <Text style={[styles.count, { color: c.textMuted }]}>
          {t('storyPrivacy.nSelected', { count: selected.size })}
        </Text>
      ) : null}

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(u) => u.id}
          contentContainerStyle={{ paddingBottom: insets.bottom + 16 }}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const on = selected.has(item.id);
            return (
              <Pressable
                onPress={() => toggle(item.id)}
                style={({ pressed }) => [styles.row, pressed && { backgroundColor: c.surfaceAlt }]}
              >
                <Avatar uri={item.avatar_url} name={item.display_name || item.username} size={44} />
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {item.display_name || item.username}
                </Text>
                <View
                  style={[
                    styles.check,
                    { borderColor: on ? c.primary : c.border, backgroundColor: on ? c.primary : 'transparent' },
                  ]}
                >
                  {on ? <Icon name="check" size={15} color="#fff" /> : null}
                </View>
              </Pressable>
            );
          }}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textMuted }]}>
              {t('storyPrivacy.noContacts')}
            </Text>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { paddingHorizontal: 4, minWidth: 40, alignItems: 'center' },
  done: { fontSize: 15, fontWeight: '700' },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 14,
    marginTop: 10,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 42,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 0 },
  count: { fontSize: 12, marginHorizontal: 18, marginTop: 10 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  name: { flex: 1, fontSize: 15.5, fontWeight: '500' },
  check: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
