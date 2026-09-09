import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen } from '@/components/common';
import { useGroups } from '@/context/GroupsContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import type { Group } from '@/types';
import { relativeTime } from '@/utils/time';

/**
 * Liste « Voir tout » — soit mes groupes, soit mes chaînes selon
 * `route.params.kind`. Header + FAB de création + accès scanner.
 */
export const GroupsListScreen: React.FC<MainScreenProps<'GroupsList'>> = ({
  route,
  navigation,
}) => {
  const kind = route.params?.kind ?? 'group';
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { groups, channels, loading, reload } = useGroups();
  const c = theme.colors;

  const [refreshing, setRefreshing] = useState(false);
  const data = kind === 'channel' ? channels : groups;

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  const renderRow = ({ item }: { item: Group }) => (
    <Pressable
      style={styles.row}
      android_ripple={{ color: c.surfaceAlt }}
      onPress={() => navigation.navigate('GroupChat', { groupId: item.id, name: item.name })}
    >
      <Avatar uri={item.avatar_url} name={item.name} size={52} />
      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
            {item.name}
          </Text>
          <Text style={[styles.time, { color: item.unread_count ? c.primary : c.textFaint }]}>
            {relativeTime(item.last_message_at)}
          </Text>
        </View>
        <View style={styles.rowBottom}>
          <Text style={[styles.preview, { color: c.textMuted }]} numberOfLines={1}>
            {item.last_message_preview ??
              (kind === 'channel'
                ? t('groups.subscribersCount', { count: item.member_count })
                : t('groups.membersCount', { count: item.member_count }))}
          </Text>
          {item.unread_count > 0 ? (
            <View style={[styles.badge, { backgroundColor: c.primary }]}>
              <Text style={styles.badgeText}>
                {item.unread_count > 99 ? '99+' : item.unread_count}
              </Text>
            </View>
          ) : null}
        </View>
      </View>
    </Pressable>
  );

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={kind === 'channel' ? t('groups.channels') : t('groups.groups')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
        right={
          <View style={styles.hdrActions}>
            <Pressable onPress={() => navigation.navigate('Scanner')} hitSlop={10} style={styles.hdrBtn}>
              <Icon name="qrcode-scan" size={21} color={c.text} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('CreateGroup', { kind })}
              hitSlop={10}
              style={styles.hdrBtn}
            >
              <Icon name="plus" size={23} color={c.text} />
            </Pressable>
          </View>
        }
      />

      {loading && data.length === 0 ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <FlatList
          data={data}
          keyExtractor={(g) => g.id}
          renderItem={renderRow}
          ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
          contentContainerStyle={data.length === 0 ? styles.emptyWrap : undefined}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await reload();
                setRefreshing(false);
              }}
              tintColor={c.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon
                  name={kind === 'channel' ? 'bullhorn-outline' : 'account-multiple-outline'}
                  size={34}
                  color={c.textFaint}
                />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {kind === 'channel' ? t('groups.noChannels') : t('groups.noGroups')}
              </Text>
              <Pressable
                onPress={() => navigation.navigate('CreateGroup', { kind })}
                style={[styles.cta, { backgroundColor: c.primary }]}
              >
                <Icon name="plus" size={18} color="#fff" />
                <Text style={styles.ctaText}>
                  {kind === 'channel' ? t('groups.createChannel') : t('groups.createGroup')}
                </Text>
              </Pressable>
            </View>
          }
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrActions: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  name: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8 },
  time: { fontSize: 12, fontWeight: '600' },
  preview: { fontSize: 14, flex: 1, marginRight: 8 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 80 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40 },
  emptyIcon: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 15, fontWeight: '700', textAlign: 'center' },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 24,
  },
  ctaText: { color: '#fff', fontWeight: '700', fontSize: 14 },
});
