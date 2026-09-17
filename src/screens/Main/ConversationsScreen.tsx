import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  ScrollView,
  View,
} from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showSheet, showToast } from '@/components/common';
import { useStories } from '@/context/StoriesContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs } from '@/context/WebSocketContext';
import { BAR_HEIGHT } from '@/navigation/TabNavigator';
import type { MainNav } from '@/navigation/types';
import { onLocalMessageEvent } from '@/context/MessageSync';
import { notificationRepo } from '@/db/repositories/notificationRepo';
import { conversationService } from '@/services';
import type { ConversationSummary, MessageType } from '@/types';
import { relativeTime } from '@/utils/time';

const BADGE = require('@/assets/logo_badge.png');

/** Ligne avec animation d'apparition (fondu + léger glissement), décalée
 * selon la position — on ne l'anime QU'au premier affichage. */
const AnimatedRow: React.FC<{ index: number; children: React.ReactNode }> = ({
  index,
  children,
}) => {
  const anim = useRef(new Animated.Value(0)).current;
  const done = useRef(false);
  useEffect(() => {
    if (done.current) return;
    done.current = true;
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, 12) * 28,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [anim, index]);
  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [
          { translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
};

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

const PAGE_SIZE = 30;

export const ConversationsScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { addListener } = useWs();
  const { ready, syncNow, online, syncing, pending } = useSync();
  const { feed: storyFeed } = useStories();
  const insets = useSafeAreaInsets();
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
  const [notifUnread, setNotifUnread] = useState(0);
  // pagination locale (LIMIT/OFFSET SQLite) : `hasMore` estime qu'il reste des
  // pages tant que la dernière page lue était pleine.
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const loadingMoreRef = useRef(false);

  useEffect(() => {
    const refresh = () => void notificationRepo.unreadCount().then(setNotifUnread);
    refresh();
    return notificationRepo.subscribe(refresh);
  }, []);

  // recharge toujours la 1ère page en entier (comportement historique) : les
  // events temps réel (nouveau message, lecture, présence...) peuvent changer
  // l'ordre ou le contenu de n'importe quelle conversation déjà visible, donc
  // on ne peut pas se contenter d'un patch partiel ici. Seul `loadMore`
  // (scroll infini) étend au-delà de cette 1ère page.
  const load = useCallback(async () => {
    if (!ready) return;
    try {
      const page1 = await conversationService.list(PAGE_SIZE, 0);
      setItems(page1);
      setHasMore(page1.length >= PAGE_SIZE);
    } finally {
      setLoading(false);
    }
  }, [ready]);

  /** Scroll infini : ajoute la page suivante sous les conversations déjà
   * affichées. Dédupliqué par id (une conv déjà chargée peut ressurgir si
   * `load()` a tourné entre-temps et décalé les offsets). */
  const loadMore = useCallback(async () => {
    if (!ready || loadingMoreRef.current || !hasMore) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const next = await conversationService.list(PAGE_SIZE, items.length);
      setItems((cur) => {
        const seen = new Set(cur.map((conv) => conv.id));
        const merged = cur.slice();
        for (const conv of next) {
          if (!seen.has(conv.id)) {
            seen.add(conv.id);
            merged.push(conv);
          }
        }
        return merged;
      });
      setHasMore(next.length >= PAGE_SIZE);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [ready, hasMore, items.length]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // Bouton retour Android depuis l'écran d'accueil (onglet Discussions, à la
  // racine de la pile) : façon Facebook, un premier appui affiche un toast
  // ("Appuyez encore pour quitter") ; un second appui dans les 2s qui
  // suivent ferme réellement l'app. Ce handler n'est actif que tant que cet
  // écran est au premier plan (useFocusEffect), donc ne se déclenche jamais
  // depuis une conversation ouverte ou un autre onglet/écran empilé dessus.
  const lastBackPressRef = useRef(0);
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener('hardwareBackPress', () => {
        const now = Date.now();
        if (now - lastBackPressRef.current < 2000) {
          BackHandler.exitApp();
          return true;
        }
        lastBackPressRef.current = now;
        showToast(t('exitApp.pressAgain'), { type: 'info', duration: 2000 });
        return true;
      });
      return () => sub.remove();
    }, [t]),
  );

  // `conversationService.list()` ne lit QUE le cache SQLite local — au tout
  // premier login (ou relance d'app), ce cache peut encore être vide tant
  // que la synchro réseau lancée par SyncContext (fire-and-forget, au
  // montage) n'a pas fini d'écrire les conversations en base. Sans ceci,
  // `load()` lisait une base vide une seule fois et ne rechargeait plus
  // jamais tout seul — d'où le besoin de tirer manuellement pour rafraîchir.
  // On relit donc AUSSI dès qu'une passe de synchro se termine (`syncing`
  // true -> false), tant qu'on n'a encore rien à afficher.
  const [hasSyncedOnce, setHasSyncedOnce] = useState(false);
  const prevSyncing = useRef(syncing);
  useEffect(() => {
    if (prevSyncing.current && !syncing) {
      setHasSyncedOnce(true);
      void load();
    }
    prevSyncing.current = syncing;
  }, [syncing, load]);

  // Tant qu'aucune conversation n'est encore affichée ET qu'aucune synchro
  // ne s'est encore terminée depuis le montage, on reste en chargement
  // (spinner) plutôt que de montrer prématurément l'état vide — la 1ère
  // synchro peut prendre quelques centaines de ms à quelques secondes après
  // le login. `hasSyncedOnce` évite un flash "vide" entre le tout premier
  // rendu (avant que `syncing` ne passe à `true`) et le début réel de la sync.
  const initialLoading = items.length === 0 && (loading || syncing || !hasSyncedOnce);

  // message entrant ingéré globalement -> on recharge la liste (dernier msg,
  // ordre, non-lus). Les autres events (lecture, présence, suppression) via WS.
  useEffect(() => onLocalMessageEvent(() => void load()), [load]);

  // conv_id -> 'text' | 'audio' pendant que le partenaire écrit / enregistre
  const [typingByConv, setTypingByConv] = useState<Record<string, 'text' | 'audio'>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  useEffect(() => {
    const clearTyping = (cid: string) =>
      setTypingByConv((m) => {
        if (!(cid in m)) return m;
        const next = { ...m };
        delete next[cid];
        return next;
      });

    return addListener((e) => {
      if (
        e.type === 'message.deleted' ||
        e.type === 'receipt.read' ||
        e.type === 'receipt.delivered' ||
        e.type === 'presence.update'
      ) {
        void load();
      } else if (e.type === 'typing.start' && e.conversation_id) {
        const cid = e.conversation_id as string;
        setTypingByConv((m) => ({ ...m, [cid]: e.activity === 'audio' ? 'audio' : 'text' }));
        // filet de sécurité : si le `typing.stop` se perd, on efface après 6 s
        if (typingTimers.current[cid]) clearTimeout(typingTimers.current[cid]);
        typingTimers.current[cid] = setTimeout(() => clearTyping(cid), 6000);
      } else if (e.type === 'typing.stop' && e.conversation_id) {
        const cid = e.conversation_id as string;
        if (typingTimers.current[cid]) clearTimeout(typingTimers.current[cid]);
        clearTyping(cid);
      } else if (e.type === 'message.new') {
        // un message reçu -> on n'écrit plus
        const cid = (e as { conversation_id?: string }).conversation_id;
        if (cid && typingTimers.current[cid]) {
          clearTimeout(typingTimers.current[cid]);
          clearTyping(cid);
        }
      }
    });
  }, [addListener, load]);

  const labels = {
    encrypted: t('conversations.messageUnavailable'),
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

  const FILTER_OPTS: { key: ConvFilter; label: string; icon: string }[] = [
    { key: 'all', label: t('conversations.filterAll'), icon: 'checkbox-multiple-blank-circle-outline' },
    { key: 'unread', label: t('conversations.filterUnread'), icon: 'email-mark-as-unread' },
    { key: 'muted', label: t('conversations.filterMuted'), icon: 'bell-off-outline' },
    { key: 'requests', label: t('conversations.filterRequests'), icon: 'account-clock-outline' },
  ];

  /** « Supprimer la conversation » — retire la ligne de MA liste (l'autre
   * garde la sienne, l'historique n'est pas effacé ; réapparaît si l'autre
   * réécrit). Optimiste : la ligne disparaît immédiatement de l'écran. */
  const deleteConversation = useCallback(
    (item: ConversationSummary) => {
      const name = item.partner.display_name || item.partner.username || '—';
      confirmAlert(
        t('chat.deleteConvTitle'),
        t('chat.deleteConvBody', { name }),
        async () => {
          setItems((cur) => cur.filter((conv) => conv.id !== item.id));
          try {
            await conversationService.hide(item.id);
          } catch {
            showToast(t('errors.generic'), { type: 'error' });
            void load(); // échec réseau -> on la fait réapparaître
          }
        },
        { destructive: true, confirmText: t('common.delete') },
      );
    },
    [t, load],
  );

  const openRowMenu = (item: ConversationSummary) => {
    const name = item.partner.display_name || item.partner.username || '—';
    showSheet({
      title: name,
      actions: [
        {
          label: item.muted ? t('chat.menuUnmute') : t('chat.menuMute'),
          icon: item.muted ? 'bell-outline' : 'bell-off-outline',
          onPress: () => void conversationService.setMuted(item.id, !item.muted).then(load),
        },
        {
          label: t('chat.deleteConversation'),
          icon: 'delete-outline',
          destructive: true,
          onPress: () => deleteConversation(item),
        },
      ],
    });
  };

  const renderDeleteAction = (item: ConversationSummary) => (
    <Pressable
      onPress={() => deleteConversation(item)}
      style={[styles.swipeDelete, { backgroundColor: c.danger }]}
    >
      <Icon name="delete-outline" size={22} color="#fff" />
      <Text style={styles.swipeDeleteTxt}>{t('common.delete')}</Text>
    </Pressable>
  );

  const renderRow = ({ item, index }: { item: ConversationSummary; index: number }) => {
    const name = item.partner.display_name || item.partner.username || '—';
    const incoming = item.request_status === 'pending_incoming';
    const hasStory = storyByAuthor.has(item.partner.id);
    const storyUnseen = storyByAuthor.get(item.partner.id) === true;
    const unread = item.unread_count > 0;
    return (
      <AnimatedRow index={index}>
      <Swipeable
        renderRightActions={() => renderDeleteAction(item)}
        overshootRight={false}
      >
      <Pressable
        android_ripple={{ color: c.surfaceAlt }}
        style={[styles.card, { backgroundColor: c.card, borderColor: c.border, shadowColor: c.text }]}
        onPress={() =>
          navigation.navigate('Chat', {
            conversationId: item.id,
            partnerId: item.partner.id,
            partnerName: name,
            partnerAvatar: item.partner.avatar_url,
          })
        }
        onLongPress={() => openRowMenu(item)}
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
            />
          </Pressable>
        ) : (
          <Avatar
            uri={item.partner.avatar_url}
            name={name}
            size={54}
          />
        )}
        <View style={styles.rowBody}>
          <View style={styles.rowTop}>
            <Text
              style={[styles.name, { color: c.text, fontWeight: unread ? '800' : '700' }]}
              numberOfLines={1}
            >
              {name}
            </Text>
            <Text style={[styles.time, { color: unread ? c.primary : c.textFaint }]}>
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
              const activity = typingByConv[item.id];
              if (activity) {
                return (
                  <View style={styles.previewRow}>
                    <Icon
                      name={activity === 'audio' ? 'microphone' : 'pencil'}
                      size={14}
                      color={c.primary}
                    />
                    <Text
                      style={[styles.preview, styles.previewItalic, { color: c.primary }]}
                      numberOfLines={1}
                    >
                      {activity === 'audio' ? t('chat.recordingAudio') : t('common.typing')}
                    </Text>
                  </View>
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
                  <Text
                    style={[
                      styles.preview,
                      { color: unread ? c.text : c.textMuted, fontWeight: unread ? '600' : '400' },
                    ]}
                    numberOfLines={1}
                  >
                    {text}
                  </Text>
                </View>
              );
            })()}
            <View style={styles.rowBadges}>
              {item.muted ? <Icon name="bell-off-outline" size={14} color={c.textFaint} /> : null}
              {unread ? (
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
      </Swipeable>
      </AnimatedRow>
    );
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        compact
        left={
          <View style={styles.brandRow}>
            <Image source={BADGE} style={styles.brandLogo} />
            <Text style={[styles.brandText, { color: c.onHeader }]}>E-discussion</Text>
          </View>
        }
        right={
          <View style={styles.headerRight}>
            <Pressable
              onPress={() => navigation.navigate('Appointments')}
              style={styles.bellBtn}
              hitSlop={8}
              android_ripple={{ color: c.overlay, borderless: true }}
            >
              <Icon name="calendar-outline" size={20} color={c.onHeader} />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('NotificationHistory')}
              style={styles.bellBtn}
              hitSlop={8}
              android_ripple={{ color: c.overlay, borderless: true }}
            >
              <Icon name="bell-outline" size={20} color={c.onHeader} />
              {notifUnread > 0 ? (
                <View style={styles.bellDot}>
                  <Text style={styles.bellDotTxt}>
                    {notifUnread > 9 ? '9+' : notifUnread}
                  </Text>
                </View>
              ) : null}
            </Pressable>
          </View>
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
            <View style={styles.syncIconWrap}>
              {!online ? (
                <Icon name="cloud-off-outline" size={19} color={c.onHeader} />
              ) : pending > 0 || syncing ? (
                <Animated.View style={{ transform: [{ rotate: spinDeg }] }}>
                  <Icon name="sync" size={19} color={c.onHeader} />
                </Animated.View>
              ) : (
                <Icon name="check-circle-outline" size={19} color={c.onHeader} />
              )}
            </View>
          </View>
        }
      />

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterChipsRow}
        style={[styles.filterChipsScroll, { backgroundColor: c.background }]}
      >
        {FILTER_OPTS.map((o) => {
          const active = convFilter === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => setConvFilter(o.key)}
              style={[
                styles.filterChip,
                {
                  backgroundColor: active ? c.primary : c.surfaceAlt,
                  borderColor: active ? c.primary : c.border,
                },
              ]}
            >
              <Icon name={o.icon} size={14} color={active ? '#fff' : c.textMuted} />
              <Text style={[styles.filterChipTxt, { color: active ? '#fff' : c.textMuted }]}>
                {o.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <FlatList
        data={filtered}
        keyExtractor={(it) => it.id}
        contentContainerStyle={
          filtered.length === 0 ? styles.emptyWrap : styles.listContent
        }
        ListHeaderComponent={null}
        onEndReachedThreshold={0.4}
        onEndReached={() => void loadMore()}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.footerLoading}>
              <ActivityIndicator color={c.primary} />
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
        ListEmptyComponent={
          initialLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={c.primary} />
            </View>
          ) : (
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
          )
        }
        renderItem={renderRow}
      />

      <Pressable
        onPress={() => navigation.navigate('NewConversation')}
        style={[
          styles.fab,
          { backgroundColor: c.primary, bottom: BAR_HEIGHT + insets.bottom + -30 },
        ]}
        android_ripple={{ color: '#ffffff30' }}
      >
        <Icon name="square-edit-outline" size={22} color="#fff" />
      </Pressable>
    </Screen>
  );
};

const styles = StyleSheet.create({
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: 9 },
  brandLogo: { width: 32, height: 32, borderRadius: 16 },
  brandText: { color: '#fff', fontSize: 20, fontWeight: '800', letterSpacing: -0.4 },
  fab: {
    position: 'absolute',
    right: 18,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
  },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bellBtn: { padding: 4 },
  bellDot: {
    position: 'absolute',
    top: -2,
    right: -4,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    paddingHorizontal: 3,
    backgroundColor: '#FF3B30',
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDotTxt: { color: '#fff', fontSize: 9.5, fontWeight: '800' },

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
  syncIconWrap: { width: 32, height: 44, alignItems: 'center', justifyContent: 'center' },

  filterChipsScroll: { flexGrow: 0 },
  filterChipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 7,
    // hauteur minimale généreuse : le texte (12px/700 + lineHeight 18)
    // doit toujours tenir sans que le chip ne le tronque en bas, quelle
    // que soit la police système de l'appareil.
    minHeight: 34,
    borderRadius: 17,
    borderWidth: 1,
  },
  filterChipTxt: { fontSize: 12, fontWeight: '700', lineHeight: 18 },

  row: { flexDirection: 'row', paddingHorizontal: 16, paddingVertical: 12, gap: 12, alignItems: 'center' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginHorizontal: 14,
    marginVertical: 5,
    padding: 12,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 1,
    shadowOpacity: 0.06,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
  },
  swipeDelete: { width: 84, alignItems: 'center', justifyContent: 'center', gap: 3 },
  swipeDeleteTxt: { color: '#fff', fontSize: 11.5, fontWeight: '700' },
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
  listContent: { paddingBottom: 8 },
  emptyWrap: { flexGrow: 1 },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80, paddingBottom: 60 },
  footerLoading: { paddingVertical: 16, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 40, paddingBottom: 60 },
  emptyIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  emptyText: { fontSize: 16, fontWeight: '700', textAlign: 'center' },
  emptyHint: { fontSize: 13.5, textAlign: 'center', lineHeight: 19 },
});
