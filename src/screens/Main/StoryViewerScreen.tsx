import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Video, { type VideoRef } from 'react-native-video';

import { Avatar, CachedImage, confirmAlert, Icon } from '@/components/common';
import { fontStyle, QUICK_REACTIONS } from '@/components/story/storyConfig';
import { useCachedMedia } from '@/hooks/useCachedMedia';
import { useWs } from '@/context/WebSocketContext';
import type { MainStackParamList, MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import { getVoiceState, subscribeVoice, stopVoice, toggleVoice } from '@/services/voicePlayer';
import type { Story, StoryFeedItem } from '@/types';
import { relativeTime } from '@/utils/time';
import { mediaUrl } from '@/utils/media';

/**
 * `.pause()` sur une ref `<Video>` déjà démontée côté natif lève "Video
 * Component is not mounted" (react-native-video) — ça arrive dès que React
 * démonte/remonte le composant entre la capture de la ref et l'exécution du
 * cleanup (changement de story, retour arrière). Sans conséquence ici : la
 * vue est de toute façon partie, donc rien à mettre en pause.
 */
function safePause(node: VideoRef | null): void {
  try {
    node?.pause();
  } catch {
    /* vue déjà démontée côté natif — rien à faire */
  }
}

/**
 * Vidéo d'un statut, plein écran, avec le SON (pas de `muted`, contrairement
 * à une prévisualisation) — lecture réelle au lieu de l'ancienne icône ▶
 * statique. `paused` suit l'appui maintenu du viewer (tapLeft/tapRight).
 * Télécharge d'abord le fichier localement (mêmes garanties hors-ligne que
 * le reste de l'app) avant de lancer la lecture.
 */
const StoryVideo: React.FC<{
  uri: string;
  paused: boolean;
  videoRef: React.RefObject<VideoRef | null>;
  onReady: () => void;
}> = ({ uri, paused, videoRef, onReady }) => {
  const cached = useCachedMedia(uri);
  const [localUri, setLocalUri] = useState<string | null>(cached.localUri);
  const { width, height } = useWindowDimensions();

  useEffect(() => {
    let alive = true;
    if (cached.localUri) {
      setLocalUri(cached.localUri);
      return;
    }
    void cached.download().then((u) => {
      if (alive && u) setLocalUri(u);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uri]);

  const src = localUri ?? mediaUrl(uri) ?? uri;

  return (
    <Video
      key={src}
      ref={videoRef}
      source={{ uri: src }}
      // `StyleSheet.absoluteFill` (top/right/bottom/left: 0, sans width/
      // height numériques) ne donne pas de taille CONCRÈTE à la vue au
      // moment où le natif attache sa surface de rendu — confirmé en
      // reproduisant : le lecteur chargeait et bufferisait le fichier avec
      // succès (onLoadStart puis onBuffer true/false) mais n'affichait
      // jamais aucune frame, la miniature restant figée indéfiniment par-
      // dessus. Des dimensions numériques explicites (useWindowDimensions,
      // réactif à la rotation) résolvent le problème.
      style={{ position: 'absolute', top: 0, left: 0, width, height }}
      resizeMode="cover"
      paused={paused}
      muted={false}
      repeat={false}
      onLoad={onReady}
      // Filet de sécurité : `onLoad` n'est pas toujours reçu de façon fiable
      // sur ce lecteur — `onProgress` (qui avance en continu UNIQUEMENT
      // pendant une vraie lecture) confirme que la vidéo joue déjà même si
      // `onLoad` n'a jamais été signalé, et lève l'overlay/miniature en
      // conséquence (sans lui, la miniature pouvait rester figée par-dessus
      // une vidéo qui jouait pourtant bel et bien en dessous).
      onProgress={onReady}
      onError={(e) => console.warn('[storyViewer] échec lecture vidéo:', src, e)}
    />
  );
};

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
  // ordre des auteurs du feed — pour enchaîner sur le contact suivant / précédent
  // quand on épuise les stories de l'auteur courant (façon WhatsApp).
  const feedOrder = useRef<string[]>([]);
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

  const stories: Story[] = useMemo(
    () => ownStories ?? group?.stories ?? [],
    [ownStories, group],
  );
  const current: Story | undefined = stories[idx];
  const isMine = !!ownStories;

  // ── vidéo : lecture réelle (silencieuse aux yeux du système, pas mute —
  // façon statut) au lieu de la simple icône ▶ statique d'avant ───────────
  const videoRef = useRef<VideoRef>(null);
  const [videoReady, setVideoReady] = useState(false);
  // coupe explicitement le son à chaque changement de story ET en quittant
  // l'écran (retour arrière, `navigation.replace` vers l'auteur suivant…) —
  // le simple démontage React de <Video> ne suffit pas toujours : la vidéo
  // pouvait continuer à jouer en arrière-plan un court instant, voire
  // indéfiniment si le composant restait monté pendant la transition.
  useEffect(() => {
    setVideoReady(false);
  }, [current?.id]);
  // pause SEULEMENT au démontage réel du composant (retour arrière, écran qui
  // se ferme) — surtout PAS à chaque re-render : sans le tableau de deps `[]`,
  // ce cleanup s'exécutait entre CHAQUE rendu (changement de `videoReady`,
  // de `paused`, etc.), mettant la vidéo en pause en continu et donnant
  // l'impression qu'elle « démarre puis s'arrête toute seule », débloquée
  // seulement par l'appui manuel (long press) qui la relançait. `safePause`
  // encaisse le cas où le natif a déjà démonté la vue avant que ce cleanup
  // ne tourne — sans ça `react-native-video` lève "Video Component is not
  // mounted".
  useEffect(() => {
    const node = videoRef.current;
    return () => safePause(node);
  }, []);

  // ── audio / vocal : lecture via le lecteur singleton partagé (le même
  // qui gère les notes vocales du chat) — télécharge d'abord si besoin.
  const audioSrc = current?.media_type === 'audio' || current?.media_type === 'voice'
    ? current.audio_url
    : null;
  const audioCache = useCachedMedia(audioSrc);
  const [, forceAudioRender] = useState(0);
  useEffect(() => subscribeVoice(() => forceAudioRender((n) => n + 1)), []);
  const voiceState = getVoiceState();
  const audioResolved = audioCache.localUri;
  const audioPlaying = !!audioResolved && voiceState.url === audioResolved && voiceState.playing;

  // ── chargement ──────────────────────────────────────────────────────────
  useEffect(() => {
    let alive = true;
    const apply = (mine: Story[], feed: import('@/types').StoryFeedItem[]) => {
      if (!alive) return;
      feedOrder.current = feed.map((f) => f.author.id);
      if (mine.length && mine[0]!.author_id === authorId) {
        setOwnStories(mine);
      } else {
        const g = feed.find((f) => f.author.id === authorId) ?? null;
        setGroup(g);
        const firstUnseen = g?.stories.findIndex((s) => !s.seen_by_me) ?? -1;
        if (firstUnseen > 0) setIdx(firstUnseen);
      }
    };
    // 1) cache local d'abord (instantané, hors-ligne OK)
    apply(storyService.readMineCache(), storyService.readFeedCache());
    setLoading(false);
    // 2) rafraîchit depuis le serveur si possible
    (async () => {
      try {
        const [mine, feed] = await Promise.all([storyService.mine(), storyService.feed()]);
        apply(mine, feed);
      } catch {
        /* hors-ligne — le cache local reste affiché */
      }
    })();
    return () => {
      alive = false;
    };
  }, [authorId]);

  // ── navigation entre stories / auteurs ─────────────────────────────────
  /** Remplace l'écran par le viewer d'un autre auteur (pile inchangée). */
  const jumpToAuthor = useCallback(
    (dir: 1 | -1) => {
      const order = feedOrder.current;
      const pos = order.indexOf(authorId);
      if (pos === -1) {
        navigation.goBack();
        return;
      }
      const nextId = order[pos + dir];
      if (!nextId) {
        navigation.goBack(); // plus d'auteur dans ce sens -> on ferme
        return;
      }
      navigation.replace('StoryViewer', { authorId: nextId });
    },
    [authorId, navigation],
  );

  const goNext = useCallback(() => {
    setReplied(false);
    setMyReaction(null);
    // `jumpToAuthor` déclenche navigation.replace/goBack — donc un setState
    // sur le NavigationContainer parent. Ça ne doit JAMAIS se produire dans
    // l'updater de `setIdx` : React exécute cet updater PENDANT le rendu,
    // et un setState d'un autre composant à ce moment casse le rendu en
    // cours (avertissement React "Cannot update a component while
    // rendering a different component").
    if (idx + 1 < stories.length) {
      setIdx(idx + 1);
    } else {
      jumpToAuthor(1);
    }
  }, [idx, stories.length, jumpToAuthor]);

  const goPrev = useCallback(() => {
    setReplied(false);
    setMyReaction(null);
    if (idx > 0) {
      setIdx(idx - 1);
    } else {
      jumpToAuthor(-1);
    }
  }, [idx, jumpToAuthor]);

  // `goNext` change d'identité à chaque changement d'`idx` (voir plus haut) —
  // cette ref permet à l'effet de la barre de progression de toujours
  // appeler la version courante SANS l'avoir en dépendance (ce qui relancerait
  // l'effet, et donc l'animation/la vidéo, à chaque avancée de story).
  const goNextRef = useRef(goNext);
  goNextRef.current = goNext;

  // ── balayage horizontal : ← auteur suivant · → auteur précédent ·
  //    ↓ (swipe vers le bas) ferme le viewer — façon WhatsApp/Insta.
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, g) =>
          Math.abs(g.dx) > 18 || g.dy > 24,
        onPanResponderRelease: (_e, g) => {
          if (g.dy > 90 && Math.abs(g.dx) < 60) {
            navigation.goBack();
          } else if (g.dx < -60) {
            jumpToAuthor(1);
          } else if (g.dx > 60) {
            jumpToAuthor(-1);
          }
        },
      }),
    [jumpToAuthor, navigation],
  );

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
      if (finished) goNextRef.current();
    });
    return () => {
      run.stop();
    };
    // `goNext` est LU via une ref (goNextRef, tenue à jour juste en dessous) —
    // volontairement absent des deps : `goNext` change d'identité à chaque
    // fois qu'`idx` change (nécessaire pour éviter le bug de setState pendant
    // le rendu, voir jumpToAuthor plus haut), et le mettre en dépendance ici
    // relançait CET effet à chaque changement d'idx -> l'animation (et donc
    // la vidéo) repartait de zéro en boucle au lieu de jouer normalement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, isMine]);

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
      if (finished) goNextRef.current();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused]);

  // ── lecture audio réelle (statut audio/vocal) ────────────────────────────
  // démarre dès que le fichier local est prêt (télécharge si besoin) ; suit
  // `paused` (appui maintenu = pause) ; s'arrête en changeant de story ou en
  // quittant l'écran. `play(uri)` ci-dessous ne fait JAMAIS un toggle "bascule"
  // — il force explicitement l'état voulu, pour ne pas dépendre de l'état
  // courant du lecteur partagé (qui peut aussi jouer un vocal de chat).
  useEffect(() => {
    if (!audioSrc || paused) return;
    let cancelled = false;
    (async () => {
      const uri = audioCache.localUri ?? (await audioCache.download());
      if (!uri || cancelled) return;
      const vp = getVoiceState();
      // déjà CETTE piste en cours -> ne touche à rien (évite un toggle qui
      // la mettrait en pause par erreur si l'effet se relance).
      if (vp.url === uri && vp.playing) return;
      void toggleVoice(uri, {
        conversationId: null,
        title: current?.audio_name ?? null,
        durationMs: current?.duration_sec ? current.duration_sec * 1000 : null,
      });
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [audioSrc, current?.id, paused]);

  // appui maintenu (pause) -> coupe le son immédiatement, sans attendre le
  // téléchargement ci-dessus.
  useEffect(() => {
    if (paused && audioSrc) void stopVoice();
  }, [paused, audioSrc]);

  // coupe le son en quittant l'écran (change d'auteur, retour arrière…)
  useEffect(() => () => void stopVoice(), []);

  // ── coupe TOUT son (vidéo + audio) dès que l'écran perd le focus ────────
  // Filet de sécurité au-delà du simple démontage React : couvre le cas où
  // `native-stack` garde l'écran monté pendant l'animation de transition
  // (retour arrière, `navigation.replace` vers l'auteur suivant, mise en
  // arrière-plan de l'app) — sans ça la vidéo/l'audio pouvait continuer à
  // jouer en arrière-plan après avoir quitté le viewer.
  useFocusEffect(
    useCallback(() => {
      return () => {
        safePause(videoRef.current);
        void stopVoice();
      };
    }, []),
  );

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

  const doRemoveOwn = useCallback(async () => {
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
  }, [current, stories, navigation]);

  /** Confirmation avant suppression. La lecture est mise en pause pendant que
   * l'alerte est affichée ; elle reprend si l'utilisateur annule. */
  const removeOwn = useCallback(() => {
    if (!current) return;
    setPaused(true);
    confirmAlert(
      t('stories.deleteTitle'),
      t('stories.deleteConfirm'),
      () => void doRemoveOwn(),
      {
        destructive: true,
        confirmText: t('common.delete'),
        cancelText: t('common.cancel'),
        onCancel: () => setPaused(false),
      },
    );
  }, [current, doRemoveOwn, t]);

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
    <View style={[styles.root, { backgroundColor: bg }]} {...swipe.panHandlers}>
      {/* image : PLEIN ÉCRAN (cover, façon Instagram) — tout en fond, sous
          les zones de tap / barres / en-tête / pied qui gardent leur zIndex. */}
      {current.media_type === 'image' && current.media_url ? (
        <>
          <CachedImage uri={current.media_url} style={styles.mediaFull} resizeMode="cover" />
          {current.caption ? (
            <View style={styles.mediaCaptionWrap} pointerEvents="none">
              <Text style={styles.mediaCaption}>{current.caption}</Text>
            </View>
          ) : null}
        </>
      ) : null}

      {/* vidéo : lecture réelle plein écran, synchronisée sur `paused` —
          plus juste une icône ▶ statique. */}
      {current.media_type === 'video' && current.media_url ? (
        <>
          <StoryVideo
            key={current.id}
            uri={current.media_url}
            paused={paused}
            videoRef={videoRef}
            onReady={() => setVideoReady(true)}
          />
          {!videoReady ? (
            <View style={styles.mediaFull} pointerEvents="none">
              {current.thumbnail_url ? (
                <CachedImage uri={current.thumbnail_url} style={styles.mediaFull} resizeMode="cover" />
              ) : null}
              <View style={[styles.center, StyleSheet.absoluteFillObject]}>
                <ActivityIndicator color="#fff" />
              </View>
            </View>
          ) : null}
          {current.caption ? (
            <View style={styles.mediaCaptionWrap} pointerEvents="none">
              <Text style={styles.mediaCaption}>{current.caption}</Text>
            </View>
          ) : null}
        </>
      ) : null}

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
        ) : current.media_type === 'video' ? null /* rendu plein écran plus haut */ : (
          /* audio / voice : lecture réelle via le lecteur partagé — icône et
             barre suivent l'état de lecture au lieu d'être statiques. */
          <View style={styles.mediaFallback}>
            <Pressable
              style={[styles.audioBadge, audioPlaying && styles.audioBadgeActive]}
              onPress={() => {
                if (!audioResolved) return;
                void toggleVoice(audioResolved, {
                  conversationId: null,
                  title: current.audio_name ?? null,
                });
              }}
            >
              {audioCache.downloading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Icon
                  name={
                    audioPlaying
                      ? 'pause'
                      : current.media_type === 'voice'
                        ? 'microphone'
                        : 'music-note'
                  }
                  size={40}
                  color="#fff"
                />
              )}
            </Pressable>
            <Text style={styles.audioName} numberOfLines={1}>
              {current.audio_name || t('stories.audioTrack')}
            </Text>
            {audioPlaying && voiceState.duration > 0 ? (
              <View style={styles.audioTrack}>
                <View
                  style={[
                    styles.audioTrackFill,
                    { width: `${Math.min(100, (voiceState.position / voiceState.duration) * 100)}%` },
                  ]}
                />
              </View>
            ) : null}
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
  // image plein écran (façon Instagram) : remplit tout le cadre, rogne au
  // besoin (cover) plutôt que de laisser des bandes vides autour.
  mediaFull: { ...StyleSheet.absoluteFillObject },
  mediaCaptionWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: 22,
    paddingTop: 60,
    paddingBottom: 110,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  mediaCaption: { color: '#fff', fontSize: 16, textAlign: 'center' },
  mediaFallback: { alignItems: 'center', gap: 14 },
  audioBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioBadgeActive: { backgroundColor: 'rgba(255,255,255,0.32)' },
  audioName: { color: '#fff', fontSize: 16, fontWeight: '700' },
  audioTrack: {
    width: 180,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
    marginTop: 4,
  },
  audioTrackFill: { height: 3, backgroundColor: '#fff' },
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
