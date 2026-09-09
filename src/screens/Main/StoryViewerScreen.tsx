import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { Avatar, Icon } from '@/components/common';
import { fontStyle, QUICK_REACTIONS } from '@/components/story/storyConfig';
import { useWs } from '@/context/WebSocketContext';
import type { MainStackParamList, MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { Story, StoryFeedItem } from '@/types';
import { mediaUrl } from '@/utils/media';
import { relativeTime } from '@/utils/time';

/**
 * Lecteur de stories plein écran pour UN auteur :
 *  - barres de progression animées (une par story), auto-avance en fin de barre ;
 *  - tap gauche/droite pour naviguer, appui prolongé pour mettre en pause ;
 *  - story d'autrui : marque « vue » à l'affichage, barre de réponse + réactions ;
 *  - MA story : compteur de vues cliquable → écran des spectateurs, suppression.
 */
export const StoryViewerScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const route = useRoute<RouteProp<MainStackParamList, 'StoryViewer'>>();
  const { authorId } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { addListener } = useWs();

  const [group, setGroup] = useState<StoryFeedItem | null>(null);
  const [ownStories, setOwnStories] = useState<Story[] | null>(null);
  const [idx, setIdx] = useState(0);
  const [loading, setLoading] = useState(true);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [replied, setReplied] = useState(false);
  const [paused, setPaused] = useState(false);
  const [myReaction, setMyReaction] = useState<string | null>(null);

  const progress = useRef(new Animated.Value(0)).current;
  const anim = useRef<Animated.CompositeAnimation | null>(null);
  // dernière valeur connue de `progress` (API publique addListener) — sert à
  // reprendre l'animation après une pause sans toucher à l'API privée _value.
  const progressVal = useRef(0);

  const stories: Story[] = ownStories ?? group?.stories ?? [];
  const current: Story | undefined = stories[idx];
  const isMine = !!ownStories;

  // ── chargement ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const mine = await storyService.mine();
        if (mine.length && mine[0]!.author_id === authorId) {
          if (alive) setOwnStories(mine);
        } else {
          const feed = await storyService.feed();
          const g = feed.find((f) => f.author.id === authorId) ?? null;
          if (alive) {
            setGroup(g);
            const firstUnseen = g?.stories.findIndex((s) => !s.seen_by_me) ?? -1;
            if (firstUnseen > 0) setIdx(firstUnseen);
          }
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [authorId]);

  // ── navigation entre stories ────────────────────────────────────────────
  const goNext = useCallback(() => {
    setReplied(false);
    setMyReaction(null);
    setIdx((i) => {
      if (i + 1 < stories.length) return i + 1;
      navigation.goBack();
      return i;
    });
  }, [stories.length, navigation]);

  const goPrev = useCallback(() => {
    setReplied(false);
    setMyReaction(null);
    setIdx((i) => Math.max(0, i - 1));
  }, []);

  // suit la valeur courante de la barre (API publique)
  useEffect(() => {
    const id = progress.addListener(({ value }) => {
      progressVal.current = value;
    });
    return () => progress.removeListener(id);
  }, [progress]);

  // ── barre de progression + marque vue + auto-avance ─────────────────────
  useEffect(() => {
    if (!current) return;

    setMyReaction(current.my_reaction ?? null);

    if (!isMine && !current.seen_by_me) {
      void storyService.markViewed(current.id).catch(() => undefined);
    }

    progress.setValue(0);
    progressVal.current = 0;
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: (current.duration_sec || 5) * 1000,
      useNativeDriver: false,
    });
    anim.current = run;
    run.start(({ finished }) => {
      if (finished) goNext();
    });
    return () => {
      run.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isMine, goNext]);

  // pause / reprise — reprend depuis progressVal.current
  useEffect(() => {
    if (!anim.current || !current) return;
    if (paused) {
      anim.current.stop();
      return;
    }
    const remaining =
      (1 - progressVal.current) * ((current.duration_sec || 5) * 1000);
    const run = Animated.timing(progress, {
      toValue: 1,
      duration: Math.max(200, remaining),
      useNativeDriver: false,
    });
    anim.current = run;
    run.start(({ finished }) => {
      if (finished) goNext();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // ── temps réel : ma story vue / réagie → rafraîchit le compteur ─────────
  useEffect(
    () => addListener((e) => {
      if (!isMine || !current) return;
      if (
        (e.type === 'story.viewed' || e.type === 'story.reaction') &&
        e.story_id === current.id
      ) {
        storyService
          .mine()
          .then((m) => setOwnStories(m))
          .catch(() => undefined);
      }
    }),
    [addListener, isMine, current],
  );

  // ── actions ────────────────────────────────────────────────────────────
  const sendReply = async () => {
    const body = reply.trim();
    if (!body || !current || sending) return;
    setSending(true);
    try {
      await storyService.reply(current.id, body);
      setReply('');
      setReplied(true);
    } catch (e) {
      console.warn('[story] reply failed:', e);
    } finally {
      setSending(false);
    }
  };

  const quickReact = async (emoji: string) => {
    if (!current) return;
    const next = myReaction === emoji ? null : emoji;
    setMyReaction(next);
    try {
      await storyService.react(current.id, next);
      if (next) setReplied(true);
    } catch (e) {
      console.warn('[story] react failed:', e);
      setMyReaction(myReaction);
    }
  };

  const removeOwn = async () => {
    if (!current) return;
    try {
      await storyService.remove(current.id);
      const rest = stories.filter((s) => s.id !== current.id);
      if (rest.length === 0) navigation.goBack();
      else {
        setOwnStories(rest);
        setIdx((i) => Math.min(i, rest.length - 1));
      }
    } catch (e) {
      console.warn('[story] delete failed:', e);
    }
  };

  // ── rendu ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  if (!current) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.emptyText}>{t('stories.none')}</Text>
        <Pressable onPress={() => navigation.goBack()} style={styles.closeBtn}>
          <Text style={styles.closeText}>{t('common.ok')}</Text>
        </Pressable>
      </View>
    );
  }

  const bg = current.background_color || '#111827';
  const author = group?.author;

  return (
    <View style={[styles.root, { backgroundColor: bg }]}>
      {/* zones de tap + pause au maintien */}
      <Pressable
        style={styles.tapLeft}
        onPress={goPrev}
        onLongPress={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
        delayLongPress={180}
      />
      <Pressable
        style={styles.tapRight}
        onPress={goNext}
        onLongPress={() => setPaused(true)}
        onPressOut={() => setPaused(false)}
        delayLongPress={180}
      />

      {/* barres de progression */}
      <View style={[styles.progress, { top: insets.top + 6 }]}>
        {stories.map((s, i) => (
          <View key={s.id} style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width:
                    i < idx
                      ? '100%'
                      : i === idx
                        ? progress.interpolate({
                            inputRange: [0, 1],
                            outputRange: ['0%', '100%'],
                          })
                        : '0%',
                },
              ]}
            />
          </View>
        ))}
      </View>

      {/* en-tête auteur */}
      <View style={[styles.topBar, { top: insets.top + 18 }]}>
        <Avatar
          uri={isMine ? undefined : author?.avatar_url}
          name={isMine ? t('stories.myStatus') : author?.display_name || author?.username || '—'}
          size={34}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.authorName} numberOfLines={1}>
            {isMine
              ? t('stories.myStatus')
              : author?.display_name || author?.username || '—'}
          </Text>
          <Text style={styles.time}>
            {relativeTime(current.created_at)}
            {current.edited_at ? ` · ${t('stories.edited')}` : ''}
          </Text>
        </View>
        {isMine ? (
          <Pressable onPress={removeOwn} hitSlop={12} style={styles.iconBtn}>
            <Icon name="delete-outline" size={22} color="#fff" />
          </Pressable>
        ) : null}
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={24} color="#fff" />
        </Pressable>
      </View>

      {/* contenu selon le type de média */}
      <View style={styles.content}>
        {current.media_type === 'text' ? (
          <Text style={[styles.storyText, fontStyle(current.font)]}>{current.caption}</Text>
        ) : current.media_type === 'image' ? (
          <>
            {current.media_url ? (
              <Image source={{ uri: mediaUrl(current.media_url) }} style={styles.media} resizeMode="contain" />
            ) : null}
            {current.caption ? <Text style={styles.mediaCaption}>{current.caption}</Text> : null}
          </>
        ) : current.media_type === 'video' ? (
          <View style={styles.mediaFallback}>
            <Icon name="play-circle" size={64} color="#ffffffdd" />
            {current.caption ? <Text style={styles.mediaCaption}>{current.caption}</Text> : null}
          </View>
        ) : (
          /* audio / voice */
          <View style={styles.mediaFallback}>
            <View style={styles.audioBadge}>
              <Icon
                name={current.media_type === 'voice' ? 'microphone' : 'music-note'}
                size={40}
                color="#fff"
              />
            </View>
            <Text style={styles.audioName} numberOfLines={1}>
              {current.audio_name || t('stories.audioTrack')}
            </Text>
            {current.caption ? <Text style={styles.mediaCaption}>{current.caption}</Text> : null}
          </View>
        )}
      </View>

      {/* pied : MA story -> stats cliquables ; story d'autrui -> réponse */}
      {isMine ? (
        <Pressable
          style={[styles.footer, styles.footerMine, { paddingBottom: 12 + insets.bottom }]}
          onPress={() => navigation.navigate('StoryViewers', { storyId: current.id })}
        >
          <Icon name="eye-outline" size={20} color="#fff" />
          <Text style={styles.statText}>
            {t('stories.viewsCount', { count: current.view_count })}
          </Text>
          {current.reaction_count > 0 ? (
            <View style={styles.reactStat}>
              <Icon name="heart" size={18} color="#fff" />
              <Text style={styles.statText}>{current.reaction_count}</Text>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          <Text style={styles.viewersLink}>{t('stories.seeViewers')}</Text>
          <Icon name="chevron-right" size={20} color="#fff" />
        </Pressable>
      ) : replied ? (
        <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
          <Text style={styles.sentHint}>{t('stories.replySent')}</Text>
        </View>
      ) : (
        <View style={[styles.replyWrap, { paddingBottom: 10 + insets.bottom }]}>
          <View style={styles.reactions}>
            {QUICK_REACTIONS.map((emoji) => (
              <Pressable key={emoji} onPress={() => quickReact(emoji)} hitSlop={6}>
                <Icon
                  name={emoji}
                  size={26}
                  color={myReaction === emoji ? '#FFD54F' : '#fff'}
                />
              </Pressable>
            ))}
          </View>
          <View style={styles.replyRow}>
            <TextInput
              value={reply}
              onChangeText={setReply}
              onFocus={() => setPaused(true)}
              onBlur={() => setPaused(false)}
              placeholder={t('stories.replyPlaceholder')}
              placeholderTextColor="#ffffffcc"
              style={styles.replyInput}
              selectionColor="#fff"
            />
            <Pressable
              onPress={sendReply}
              disabled={!reply.trim() || sending}
              hitSlop={8}
              style={{ opacity: reply.trim() && !sending ? 1 : 0.4 }}
            >
              <Icon name="send" size={22} color="#fff" />
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  center: { alignItems: 'center', justifyContent: 'center', gap: 16 },
  emptyText: { color: '#fff', fontSize: 16 },
  closeBtn: { paddingHorizontal: 20, paddingVertical: 10, borderWidth: 1, borderColor: '#fff', borderRadius: 20 },
  closeText: { color: '#fff', fontWeight: '700' },
  tapLeft: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '35%', zIndex: 5 },
  tapRight: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '65%', zIndex: 5 },
  progress: { position: 'absolute', left: 10, right: 10, flexDirection: 'row', gap: 4, zIndex: 10 },
  progressTrack: { flex: 1, height: 3, borderRadius: 2, backgroundColor: '#ffffff44', overflow: 'hidden' },
  progressFill: { height: 3, backgroundColor: '#fff' },
  topBar: {
    position: 'absolute',
    left: 12,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    zIndex: 10,
  },
  authorName: { color: '#fff', fontWeight: '700', fontSize: 14 },
  time: { color: '#ffffffcc', fontSize: 12 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 26 },
  storyText: { color: '#fff', fontSize: 26, fontWeight: '700', textAlign: 'center' },
  media: { width: '100%', height: '70%' },
  mediaCaption: { color: '#fff', fontSize: 16, textAlign: 'center', marginTop: 14 },
  mediaFallback: { alignItems: 'center', gap: 14 },
  audioBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  footer: { flexDirection: 'row', gap: 8, paddingHorizontal: 20, alignItems: 'center', zIndex: 10 },
  footerMine: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#ffffff33',
    paddingTop: 12,
  },
  statText: { color: '#fff', fontWeight: '700' },
  reactStat: { flexDirection: 'row', alignItems: 'center', gap: 4, marginLeft: 12 },
  viewersLink: { color: '#fff', fontWeight: '600', fontSize: 13, marginRight: 2 },
  sentHint: { color: '#fff', fontWeight: '600' },
  replyWrap: { paddingHorizontal: 16, gap: 12, zIndex: 10 },
  reactions: { flexDirection: 'row', justifyContent: 'space-around', paddingHorizontal: 10 },
  replyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderColor: '#ffffff66',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  replyInput: { flex: 1, color: '#fff', fontSize: 15 },
});
