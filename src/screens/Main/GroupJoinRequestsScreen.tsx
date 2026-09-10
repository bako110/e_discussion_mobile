/**
 * File des demandes d'adhésion à un groupe / une chaîne (admins).
 * Chaque ligne : profil du demandeur + Approuver / Refuser.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showToast } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import type { GroupJoinRequest } from '@/types';
import { relativeTime } from '@/utils/time';

export const GroupJoinRequestsScreen: React.FC<MainScreenProps<'GroupJoinRequests'>> = ({
  route,
  navigation,
}) => {
  const { groupId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [reqs, setReqs] = useState<GroupJoinRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReqs(await groupService.joinRequests(groupId));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [groupId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const decide = async (userId: string, approve: boolean) => {
    setBusy(userId);
    try {
      if (approve) await groupService.approveJoin(groupId, userId);
      else await groupService.rejectJoin(groupId, userId);
      setReqs((r) => r.filter((x) => x.user.id !== userId));
      showToast(
        approve ? t('groupSettings.requestApproved') : t('groupSettings.requestRejected'),
      );
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('groupSettings.pendingRequests')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <FlatList
          data={reqs}
          keyExtractor={(r) => r.user.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <Text style={[styles.hint, { color: c.textMuted }]}>
              {t('groupSettings.pendingHint')}
            </Text>
          }
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textMuted }]}>
              {t('groupSettings.noPending')}
            </Text>
          }
          renderItem={({ item }) => (
            <View style={styles.row}>
              <Avatar
                uri={item.user.avatar_url}
                name={item.user.display_name || item.user.username}
                size={44}
              />
              <View style={styles.body}>
                <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
                  {item.user.display_name || item.user.username}
                </Text>
                <Text style={[styles.sub, { color: c.textMuted }]}>
                  {relativeTime(item.requested_at)}
                </Text>
              </View>
              {busy === item.user.id ? (
                <ActivityIndicator color={c.primary} />
              ) : (
                <View style={styles.actions}>
                  <Pressable
                    onPress={() => void decide(item.user.id, false)}
                    hitSlop={8}
                    style={[styles.actBtn, { borderColor: c.border }]}
                  >
                    <Icon name="close" size={18} color={c.danger} />
                  </Pressable>
                  <Pressable
                    onPress={() => void decide(item.user.id, true)}
                    hitSlop={8}
                    style={[styles.actBtn, { backgroundColor: c.primary, borderColor: c.primary }]}
                  >
                    <Icon name="check" size={18} color="#fff" />
                  </Pressable>
                </View>
              )}
            </View>
          )}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  list: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  body: { flex: 1 },
  name: { fontSize: 15.5, fontWeight: '600' },
  sub: { fontSize: 12, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8 },
  actBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
  hint: { fontSize: 13, lineHeight: 18, paddingHorizontal: 16, paddingTop: 6, paddingBottom: 10 },
});
