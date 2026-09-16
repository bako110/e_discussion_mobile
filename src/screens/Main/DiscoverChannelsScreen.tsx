/**
 * Annuaire des chaînes publiques — découvrables sans invitation ni contact
 * commun. Recherche par nom + filtre catégorie ; tap sur un item ouvre
 * l'aperçu (façon scan QR) avant adhésion.
 */
import React, { useCallback, useEffect, useState } from 'react';
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

import { AppHeader, Avatar, Icon, Screen, showSheet } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';
import { GROUP_CATEGORIES, type GroupCategory, type GroupPreview } from '@/types';

/** Ligne d'une chaîne de l'annuaire — la description peut être longue
 * (texte libre saisi par l'admin de la chaîne) : tronquée à 2 lignes par
 * défaut, avec un "Voir plus" pour la déplier sans quitter la liste. Chaque
 * ligne garde son propre état d'expansion (indépendant des autres). */
const ChannelRow: React.FC<{
  item: GroupPreview;
  onPress: () => void;
}> = ({ item, onPress }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const [expanded, setExpanded] = useState(false);
  const [truncated, setTruncated] = useState(false);

  return (
    <Pressable onPress={onPress} style={styles.row} android_ripple={{ color: c.surfaceAlt }}>
      <Avatar uri={item.avatar_url} name={item.name} size={48} />
      <View style={styles.body}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {item.name}
        </Text>
        <Text style={[styles.sub, { color: c.textMuted }]} numberOfLines={1}>
          {t('groups.subscribersCount', { count: item.member_count })}
          {item.category ? ` · ${t(`groups.category_${item.category}`)}` : ''}
          {item.is_paid ? ` · ${t('groupSettings.ch_subscription')}` : ''}
        </Text>
        {item.description ? (
          <>
            <Text
              style={[styles.description, { color: c.textMuted }]}
              numberOfLines={expanded ? undefined : 2}
              onTextLayout={(e) => {
                if (!expanded && e.nativeEvent.lines.length > 2) setTruncated(true);
              }}
            >
              {item.description}
            </Text>
            {truncated ? (
              <Pressable onPress={() => setExpanded((v) => !v)} hitSlop={6}>
                <Text style={[styles.seeMore, { color: c.primary }]}>
                  {expanded ? t('common.seeLess') : t('common.seeMore')}
                </Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </View>
      <Icon name="chevron-right" size={20} color={c.textFaint} />
    </Pressable>
  );
};

export const DiscoverChannelsScreen: React.FC<MainScreenProps<'DiscoverChannels'>> = ({
  navigation,
}) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<GroupCategory | null>(null);
  const [items, setItems] = useState<GroupPreview[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await groupService.discover({
        category: category ?? undefined,
        query: query.trim() || undefined,
      });
      setItems(res.items);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [category, query]);

  useEffect(() => {
    const id = setTimeout(() => void load(), 300);
    return () => clearTimeout(id);
  }, [load]);

  const pickCategory = () => {
    showSheet({
      title: t('groups.categoryPick'),
      actions: [
        {
          label: t('groups.categoryNone') + (category === null ? '  ✓' : ''),
          onPress: () => setCategory(null),
        },
        ...GROUP_CATEGORIES.map((cat) => ({
          label: t(`groups.category_${cat}`) + (category === cat ? '  ✓' : ''),
          onPress: () => setCategory(cat),
        })),
      ],
    });
  };

  const openPreview = (item: GroupPreview) => {
    if (!item.invite_code) return;
    navigation.navigate('JoinPreview', { code: item.invite_code, preview: item });
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('groups.discoverTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="magnify" size={18} color={c.textMuted} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('groups.discoverSearchPlaceholder')}
            placeholderTextColor={c.textFaint}
            style={[styles.searchInput, { color: c.text }]}
          />
        </View>
        <Pressable
          onPress={pickCategory}
          style={[styles.filterBtn, { borderColor: c.border }]}
        >
          <Icon name="filter-variant" size={18} color={category ? c.primary : c.textMuted} />
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={c.primary} />
      ) : (
        <FlatList
          data={items}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <Text style={[styles.empty, { color: c.textMuted }]}>
              {t('groups.discoverEmpty')}
            </Text>
          }
          renderItem={({ item }) => <ChannelRow item={item} onPress={() => openPreview(item)} />}
        />
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  searchRow: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    height: 40,
  },
  searchInput: { flex: 1, fontSize: 15 },
  filterBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: { paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10 },
  body: { flex: 1 },
  name: { fontSize: 15.5, fontWeight: '600' },
  sub: { fontSize: 12.5, marginTop: 2 },
  description: { fontSize: 12.5, marginTop: 3, lineHeight: 17 },
  seeMore: { fontSize: 12.5, fontWeight: '700', marginTop: 2 },
  empty: { textAlign: 'center', marginTop: 40, fontSize: 14 },
});
