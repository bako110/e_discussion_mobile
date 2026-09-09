import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showSheet } from '@/components/common';
import { useStories } from '@/context/StoriesContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs } from '@/context/WebSocketContext';
import type { MainNav } from '@/navigation/types';
import { onLocalMessageEvent } from '@/context/MessageSync';
import { conversationService } from '@/services';
import type { ConversationSummary, MessageType } from '@/types';
import { relativeTime } from '@/utils/time';

const BADGE = require('@/assets/logo_badge.png');

/** Icone + libelle pour l'apercu du dernier message selon son type.
 *
 * `hasPlainText` : on a le texte clair en local (message dechiffre stocke via
 * touchLastMessage). Dans ce cas on n'affiche PAS le cadenas — on laisse
 * l'appelant montrer le texte. Le cadenas ne reste que si le contenu chiffre
 * n'a jamais pu etre dechiffre (hasPlainText=false). */
function previewMeta(
  type: MessageType | null,
  encrypted: boolean,
  hasPlainText: boolean,
  labels: Record<string, string>,
): { icon?: string; label: string } {
  if (encrypted && !hasPlainText) return { icon: 'lock-outline', label: labels.encrypted };
  switch (type) {
    case 'voice':
      return { icon: 'microphone', label: labels.voice };
    case 'image':
      return { icon: 'image-outline', label: labels.photo };
    case 'video':
      return { icon: 'video-outline', label: labels.video };
    case 'file':
      return { icon: 'file-outline', label: labels.file };
    case 'location':
      return { icon: 'map-marker-outline', label: labels.location };
    default:
      return { label: '' };
  }
}

type ConvFilter = 'all' | 'unread' | 'muted' | 'requests';

export const ConversationsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { addListener } = useWs();
  const { ready, syncNow, online, syncing, pending } = useSync();
  const { feed: storyFeed } = useStories();
  const c = theme.colors;

  // partenaires ayant au moins une story active -> { has_unseen } pour l'anneau
  const storyByAuthor = useMemo(() => {
    const m = new Map<string, boolean>(); // authorId -> has_unseen
    for (const f of storyFeed) m.set(f.author.id, f.has_unseen);
    return m;
  }, [storyFeed]);

  // rotation continue de l'icone de synchro tant qu'une passe tourne
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!syncing) {
      spin.stopAnimation();
      spin.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 900,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [syncing, spin]);
  const spinDeg = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  const [items, setItems] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [convFilter, setConvFilter] = useState<ConvFilter>('all');

  const load = useCallback(async () => {
    if (!ready) return;
    try {
      setItems(await conversationService.list());
    } finally {
      setLoading(false);
    }
  }, [ready]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // message entrant ingéré globalement -> on recharge la liste (dernier msg,
  // ordre, non-lus). Les autres events (lecture, présence, suppression) via WS.
  useEffect(() => onLocalMessageEvent(() => void load()), [load]);

  useEffect(() => {
    return addListener((e) => {
      if (
        e.type === 'message.deleted' ||
        e.type === 'receipt.read' ||
        e.type === 'receipt.delivered' ||
        e.type === 'presence.update'
      ) {
        void load();
      }
    });
  }, [addListener, load]);

  const labels = {
    encrypted: t('conversations.encryptedMessage'),
    voice: t('conversations.voiceMessage'),
    photo: t('conversations.photo'),
    video: t('conversations.video'),
    file: t('conversations.file'),
    location: t('conversations.location'),
  };

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = items;
    if (convFilter === 'unread') {
      list = list.filter((it) => (it.unread_count ?? 0) > 0);
    } else if (convFilter === 'muted') {
      list = list.filter((it) => it.muted);
    } else if (convFilter === 'requests') {
      list = list.filter((it) => it.request_status === 'pending_incoming');
    }
    if (!q) return list;
    return list.filter((it) => {
      const name = (it.partner.display_name || it.partner.username || '').toLowerCase();
      const last = (it.last_message || '').toLowerCase();
      return name.includes(q) || last.includes(q);
    });
  }, [items, query, convFilter]);

  const openFilterMenu = () => {
    const opts: { key: ConvFilter; label: string; icon: string }[] = [
      { key: 'all', label: t('conversations.filterAll'), icon: 'checkbox-multiple-blank-circle-outline' },
      { key: 'unread', label: t('conversations.filterUnread'), icon: 'email-mark-as-unread' },
      { key: 'muted', label: t('conversations.filterMuted'), icon: 'bell-off-outline' },
      { key: 'requests', label: t('conversations.filterRequests'), icon: 'account-clock-outline' },
    ];
    showSheet({
      title: t('conversations.filterTitle'),
      actions: opts.map((o) => ({
        label: o.label + (convFilter === o.key ? '  ✓' : ''),
        icon: o.icon,
        onPress: () => setConvFilter(o.key),
      })),
    });
  };

  const renderRow = ({ item }: { item: ConversationSummary }) => {
    const name = item.partner.display_name || item.partner.username || '—';
    const incoming = item.request_status === 'pending_incoming';
    const hasStory = storyByAuthor.has(item.partner.id);
    const storyUnseen = storyByAuthor.get(item.partner.id) === true;
    return (
      <Pressable
        android_ripple={{ color: c.surfaceAlt }}
        style={styles.row}
        onPress={() =>
          navigation.navigate('Chat', {
            conversationId: item.id,
            partnerId: item.partner.id,
            partnerName: name,
            partnerAvatar: item.partner.avatar_url,
          })
        }
      >
        {hasStory ? (
          <Pressable
            onPress={() =>
              navigation.navigate('StoryViewer', { authorId: item.partner.id })
            }
            style={[
              styles.storyRing,
              { borderColor: storyUnseen ? c.primary : c.border },
            ]}
          >
            <Avatar
              uri={item.partner.avatar_url}
              name={name}
              size={48}
              online={online && item.partner.is_online}
            />
          </Pressable>
        ) : (
          <Avatar
            uri={item.partner.avatar_url}
            name={name}
            size={54}
            online={online && item.partner.is_online}
          />
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
              {name}
            </Text>
            <Text style={[styles.time, { color: item.unread_count ? c.primary : c.textFaint }]}>
              {relativeTime(item.last_message_at)}
            </Text>
          </View>
          <View style={styles.rowBottom}>
            {(() => {
              if (incoming) {
                return (
                  <Text style={[styles.preview, styles.previewItalic, { color: c.primary }]} numberOfLines={1}>
                    {t('conversations.requestPending')}
                  </Text>
                );
              }
              const hasPlain = !!(item.last_message && item.last_message.trim());
              const meta = previewMeta(
                item.last_message_type,
                item.last_message_encrypted,
                hasPlain,
                labels,
              );
              const showIcon = !!meta.icon;
              const text = showIcon ? meta.label : item.last_message ?? '';
              return (
                <View style={styles.previewRow}>
                  {showIcon ? (
                    <Icon name={meta.icon!} size={14} color={c.textFaint} />
                  ) : null}
                  <Text style={[styles.preview, { color: c.textMuted }]} numberOfLines={1}>
                    {text}
                  </Text>
                </View>
              );
            })()}
            <View style={styles.rowBadges}>
              {item.muted ? <Icon name="bell-off-outline" size={14} color={c.textFaint} /> : null}
              {item.unread_count > 0 ? (
                <View style={[styles.badge, { backgroundColor: c.primary }]}>
                  <Text style={styles.badgeText}>
                    {item.unread_count > 99 ? '99+' : item.unread_count}
                  </Text>
                </View>
              ) : null}
            </View>
          </View>
        </View>
      </Pressable>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        left={
          <View style={styles.brandRow}>
            <Image source={BADGE} style={styles.brandLogo} />
            <Text style={styles.brandText}>E-discussion</Text>
          </View>
        }
        right={
          <Pressable
            onPress={() => navigation.navigate('NewConversation')}
            style={styles.newBtn}
            android_ripple={{ color: 'rgba(255,255,255,0.18)', borderless: false }}
          >
            <Icon name="square-edit-outline" size={15} color="#fff" />
            <Text style={styles.newBtnText}>{t('conversations.newShort')}</Text>
          </Pressable>
        }
        bottom={
          <View style={styles.searchRow}>
            <View style={[styles.searchBox, { backgroundColor: c.background }]}>
              <Icon name="magnify" size={19} color={c.textFaint} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                placeholder={t('conversations.search')}
                placeholderTextColor={c.textFaint}
                style={[styles.searchInput, { color: c.text }]}
              />
              {query.length > 0 ? (
                <Pressable onPress={() => setQuery('')} hitSlop={8}>
                  <Icon name="close-circle" size={16} color={c.textFaint} />
                </Pressable>
              ) : null}
            </View>
            <Pressable
              style={[
                styles.filterBtn,
                { backgroundColor: convFilter === 'all' ? c.background : c.primary },
              ]}
              hitSlop={6}
              onPress={openFilterMenu}
            >
              <Icon
                name="tune-variant"
                size={18}
                color={convFilter === 'all' ? c.textMuted : '#fff'}
              />
            </Pressable>
          </View>
        }
      />

      {convFilter !== 'all' ? (
        <Pressable
          onPress={() => setConvFilter('all')}
          style={[styles.activeFilter, { backgroundColor: c.primary + '18', borderColor: c.primary }]}
        >
          <Icon name="filter-variant" size={13} color={c.primary} />
          <Text style={[styles.activeFilterTxt, { color: c.primary }]}>
            {t(`conversations.filter${convFilter[0]!.toUpperCase()}${convFilter.slice(1)}`)}
          </Text>
          <Icon name="close" size={13} color={c.primary} />
        </Pressable>
      ) : null}

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyWrap : styles.listContent
        }
        ListHeaderComponent={
          filtered.length > 0 || !query ? (
            <View style={styles.sectionHead}>
              <View style={styles.sectionLeft}>
                <Icon name="message-text" size={17} color={c.primary} />
                <Text style={[styles.sectionTitle, { color: c.text }]}>
                  {t('conversations.sectionTitle')}
                </Text>
              </View>
              <View style={styles.sectionRight}>
                {!online ? (
                  <>
                    <Icon name="cloud-off-outline" size={14} color={c.textMuted} />
                    <Text style={[styles.sectionState, { color: c.textMuted }]}>
                      {t('sync.offline')}
                    </Text>
                  </>
                ) : pending > 0 || syncing ? (
                  <>
                    <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                      <Icon name="sync" size={14} color={c.primary} />
                    </Animated.View>
                    <Text style={[styles.sectionState, { color: c.primary }]} numberOfLines={1}>
                      {pending > 0
                        ? t('sync.pendingCount', { count: pending })
                        : t('sync.syncing')}
                    </Text>
                  </>
                ) : (
                  <>
                    <Icon name="check-circle-outline" size={14} color={c.textFaint} />
                    <Text style={[styles.sectionState, { color: c.textFaint }]}>
                      {t('sync.upToDate')}
                    </Text>
                  </>
                )}
              </View>
            </View>
          ) : null
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={async () => {
              setRefreshing(true);
              await syncNow();
              await load();
              setRefreshing(false);
            }}
            tintColor={c.primary}
          />
        }
        ItemSeparatorComponent={() => <View style={[styles.sep, { backgroundColor: c.divider }]} />}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.empty}>
              <View style={[styles.emptyIcon, { backgroundColor: c.surfaceAlt }]}>
                <Icon name={query ? 'magnify' : 'chat-plus-outline'} size={36} color={c.textFaint} />
              </View>
              <Text style={[styles.emptyText, { color: c.text }]}>
                {query ? t('conversations.searchEmpty', { q: query }) : t('conversations.empty')}
              </Text>
              {!query ? (
                <Text style={[styles.emptyHint, { color: c.textMuted }]}>
                  {t('conversations.emptyHint')}
                </Text>
              ) : null}
            </View>
          ) : null
        }
        renderItem={renderRow}
      />
    </Screen>
  );
};

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandLogo: { width: 32, height: 32, borderRadius: 16 },
  brandText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  newBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.55)',
  },
  newBtnText: { color: '#fff', fontSize: 12.5, fontWeight: '700' },

  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    borderRadius: 22,
    paddingHorizontal: 14,
    elevation: 2,
    shadowColor: '#0A1730',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  searchInput: { flex: 1, fontSize: 14 },
  filterBtn: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 2,
    shadowColor: '#0A1730',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  activeFilter: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 14,
    borderWidth: 1,
  },
  activeFilterTxt: { fontSize: 12, fontWeight: '700' },

  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  sectionLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionTitle: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  sectionRight: { flexDirection: 'row', alignItems: 'center', gap: 5, maxWidth: '55%' },
  sectionState: { fontSize: 12.5, fontWeight: '700', flexShrink: 1 },

  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 12, alignItems: 'center' },
  storyRing: {
    width: 54,
    height: 54,
    borderRadius: 27,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: { flex: 1, justifyContent: 'center' },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  rowBottom: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 },
  rowBadges: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 16, fontWeight: '700', flex: 1, marginRight: 8, letterSpacing: -0.2 },
  time: { fontSize: 12, fontWeight: '600' },
  previewRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 4, marginRight: 8 },
  preview: { fontSize: 14, flexShrink: 1 },
  previewItalic: { fontStyle: 'italic', flex: 1, marginRight: 8 },
  badge: { minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center' },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  sep: { height: StyleSheet.hairlineWidth, marginLeft: 82 },
  listContent: { paddingBottom: 8 },
  emptyWrap: { flexGrow: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingBottom: 60 },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyHint: { fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
});
