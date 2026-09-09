import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { userService } from '@/services';
import type { UserPublic } from '@/types';

/** Liste des utilisateurs bloqués + déblocage. */
export const BlockedUsersScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [users, setUsers] = useState<UserPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setUsers(await userService.blockedUsers());
    } catch {
      /* hors-ligne */
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmUnblock = (u: UserPublic) => {
    const name = u.display_name || u.username || '—';
    showAlert(t('settings.unblockTitle', { name }), t('settings.unblockConfirm'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('settings.unblock'),
        onPress: async () => {
          setPendingId(u.id);
          try {
            await userService.unblock(u.id);
            setUsers((prev) => prev.filter((x) => x.id !== u.id));
          } catch {
            showAlert(t('errors.generic'));
          } finally {
            setPendingId(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('settings.blockedUsers')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={users}
          keyExtractor={(u) => u.id}
          contentContainerStyle={users.length === 0 ? styles.emptyWrap : styles.list}
          ItemSeparatorComponent={() => (
            <View style={[styles.sep, { backgroundColor: c.divider }]} />
          )}
          ListHeaderComponent={
            users.length > 0 ? (
              <Text style={[styles.hint, { color: c.textMuted }]}>
                {t('settings.blockedHint')}
              </Text>
            ) : null
          }
          renderItem={({ item }) => {
            const name = item.display_name || item.username || '—';
            return (
              <View style={styles.row}>
                <Avatar uri={item.avatar_url} name={name} size={44} />
                <View style={styles.body}>
                  <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                    {name}
                  </Text>
                  {item.username ? (
                    <Text style={{ color: c.textMuted, fontSize: 13 }} numberOfLines={1}>
                      @{item.username}
                    </Text>
                  ) : null}
                </View>
                <Pressable
                  onPress={() => confirmUnblock(item)}
                  disabled={pendingId === item.id}
                  style={[styles.unblockBtn, { borderColor: c.primary }]}
                >
                  {pendingId === item.id ? (
                    <ActivityIndicator size="small" color={c.primary} />
                  ) : (
                    <Text style={[styles.unblockText, { color: c.primary }]}>
                      {t('settings.unblock')}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          }}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name="account-cancel-outline" size={32} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {t('settings.noBlocked')}
              </Text>
              <Text style={[styles.emptyHint, { color: c.textMuted }]}>
                {t('settings.noBlockedHint')}
              </Text>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingVertical: 8 },
  hint: { fontSize: 13, paddingHorizontal: 16, paddingVertical: 10, lineHeight: 18 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  body: { flex: 1 },
  name: { fontSize: 15, fontWeight: '700' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 72 },
  unblockBtn: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 18,
    borderWidth: 1.5,
    minWidth: 84,
    alignItems: 'center',
  },
  unblockText: { fontSize: 13, fontWeight: '700' },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 40 },
  emptyIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700' },
  emptyHint: { fontSize: 13, textAlign: 'center' },
});
