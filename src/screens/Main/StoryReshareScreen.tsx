import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Video from 'react-native-video';

import { ApiError } from '@/api';
import { Icon, showToast } from '@/components/common';
import { fontStyle } from '@/components/story/storyConfig';
import { useStories } from '@/context/StoriesContext';
import type { MainScreenProps } from '@/navigation/types';
import { storyService } from '@/services';
import { getVoiceState, stopVoice, subscribeVoice, toggleVoice } from '@/services/voicePlayer';
import { mediaUrl } from '@/utils/media';

/**
 * Repartage d'une story existante (mienne ou d'un contact) comme nouveau
 * statut — façon WhatsApp « Ajouter à mon statut ». Le média est déjà
 * hébergé côté serveur : pas d'upload ici, juste un aperçu en lecture seule
 * + une légende éditable avant publication.
 */
export const StoryReshareScreen: React.FC<MainScreenProps<'StoryReshare'>> = ({
  route,
  navigation,
}) => {
  const { story } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { reload } = useStories();

  const [caption, setCaption] = useState(story.caption ?? '');
  const [publishing, setPublishing] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [, forceAudioRender] = useState(0);
  useEffect(() => subscribeVoice(() => forceAudioRender((n) => n + 1)), []);
  // coupe l'aperçu audio/vidéo en quittant l'écran — sinon le son continue.
  useEffect(() => () => void stopVoice(), []);

  const audioUrl =
    story.media_type === 'audio' || story.media_type === 'voice'
      ? mediaUrl(story.audio_url || story.media_url)
      : null;
  const voiceState = getVoiceState();
  const audioPlaying = !!audioUrl && voiceState.url === audioUrl && voiceState.playing;

  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      await storyService.reshare(story, caption.trim() || null);
      void reload();
      showToast(t('stories.reshareDone'));
      navigation.goBack();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      showToast(
        code === 'reshare_restricted'
          ? t('stories.reshareRestricted')
          : t('stories.reshareFailed'),
      );
    } finally {
      setPublishing(false);
    }
  };

  const rootBg = story.media_type === 'image' || story.media_type === 'video' ? '#000' : (story.background_color || '#1E2A44');

  return (
    <View style={[styles.root, { backgroundColor: rootBg, paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.headerTitle}>{t('stories.reshareTitle')}</Text>
        <View style={styles.iconBtn} />
      </View>

      <View style={styles.canvas}>
        {story.media_type === 'image' ? (
          <Image
            source={{ uri: mediaUrl(story.media_url) ?? undefined }}
            style={styles.preview}
            resizeMode="contain"
          />
        ) : story.media_type === 'video' ? (
          <Pressable style={styles.videoWrap} onPress={() => setVideoPaused((p) => !p)}>
            <Video
              source={{ uri: mediaUrl(story.media_url) ?? '' }}
              style={styles.preview}
              resizeMode="contain"
              paused={videoPaused}
              repeat
              muted={false}
              poster={mediaUrl(story.thumbnail_url) ?? undefined}
            />
            {videoPaused ? (
              <View style={styles.videoPauseOverlay} pointerEvents="none">
                <Icon name="play" size={44} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        ) : story.media_type === 'audio' || story.media_type === 'voice' ? (
          <View style={styles.mediaFallback}>
            <Pressable
              style={styles.audioBadge}
              onPress={() => {
                if (!audioUrl) return;
                void toggleVoice(audioUrl, {
                  conversationId: null,
                  title: story.audio_name || t('stories.audioTrack'),
                  durationMs: story.duration_sec ? story.duration_sec * 1000 : null,
                });
              }}
            >
              <Icon name={audioPlaying ? 'pause' : 'play'} size={40} color="#fff" />
            </Pressable>
            <Text style={styles.audioLabel}>{story.audio_name || t('stories.audioTrack')}</Text>
          </View>
        ) : (
          <Text style={[styles.textPreview, fontStyle(story.font)]}>{story.caption}</Text>
        )}
      </View>

      {story.media_type !== 'text' ? (
        <View style={styles.captionWrap}>
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder={t('stories.captionPlaceholder')}
            placeholderTextColor="#ffffffcc"
            maxLength={500}
            style={styles.captionInput}
            selectionColor="#fff"
          />
        </View>
      ) : null}

      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <View style={styles.reshareHint}>
          <Icon name="repeat-variant" size={16} color="#fff" />
          <Text style={styles.reshareHintText}>{t('stories.reshareHint')}</Text>
        </View>
        <Pressable
          onPress={publish}
          disabled={publishing}
          style={[styles.send, { opacity: publishing ? 0.6 : 1 }]}
        >
          {publishing ? (
            <ActivityIndicator color="#1E6FE0" />
          ) : (
            <Icon name="send" size={22} color="#1E6FE0" />
          )}
        </Pressable>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    height: 52,
  },
  iconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: '#fff', fontWeight: '700', fontSize: 15 },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  preview: { width: '100%', height: '100%' },
  textPreview: { color: '#fff', fontSize: 26, textAlign: 'center' },
  videoWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  videoPauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  mediaFallback: { alignItems: 'center', gap: 16 },
  audioBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  captionWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  captionInput: {
    color: '#fff',
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff55',
    paddingVertical: 8,
  },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  reshareHint: { flexDirection: 'row', alignItems: 'center', gap: 6, opacity: 0.85 },
  reshareHintText: { color: '#fff', fontSize: 12.5, fontWeight: '600' },
  send: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
