import React, { useMemo, useState } from 'react';
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
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import {
  STORY_BG_COLORS,
  STORY_FONTS,
  fontStyle,
} from '@/components/story/storyConfig';
import { useStories } from '@/context/StoriesContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import type { MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { UploadedMedia } from '@/services';
import type { StoryAudience, StoryMediaType } from '@/types';
import { mediaUrl } from '@/utils/media';

type Mode = 'text' | 'photo' | 'video' | 'audio';

/**
 * Composer de story.
 *
 * - TEXTE : fond coloré + police + légende → publication directe.
 * - PHOTO / VIDÉO : sélection galerie ou caméra → upload → aperçu + légende.
 * - AUDIO : enregistrement d'une note vocale → upload → fond coloré + légende.
 */
export const StoryComposerScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { reload } = useStories();
  const picker = useMediaPicker();

  const [mode, setMode] = useState<Mode>('text');
  const [text, setText] = useState('');
  const [bg, setBg] = useState(STORY_BG_COLORS[0]!);
  const [font, setFont] = useState(STORY_FONTS[0]!.key);
  const [audience, setAudience] = useState<StoryAudience>('everyone');
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fStyle = useMemo(() => fontStyle(font), [font]);
  const busy = publishing || picker.busy;

  // Après sélection d'un média : on passe direct à l'éditeur plein écran
  // (recadrage / dessin / légende / stickers), qui gère aussi la publication.
  const chooseImage = async (camera: boolean) => {
    const up = await picker.pickImage({ camera });
    if (up) navigation.replace('MediaEditor', { media: up });
  };
  const chooseVideo = async (camera: boolean) => {
    const up = await picker.pickVideo({ camera });
    if (up) navigation.replace('MediaEditor', { media: up });
  };

  const toggleRecord = async () => {
    if (picker.recording) {
      const res = await picker.stopRecording();
      if (res) navigation.replace('MediaEditor', { media: res.media });
    } else {
      setMode('audio');
      await picker.startRecording();
    }
  };

  const onModePress = (m: Mode) => {
    if (m === 'text') {
      setMode('text');
      setMedia(null);
      return;
    }
    if (m === 'photo') void chooseImage(false);
    else if (m === 'video') void chooseVideo(false);
    else void toggleRecord();
  };

  const canPublish =
    !busy &&
    ((mode === 'text' && text.trim().length > 0) ||
      ((mode === 'photo' || mode === 'video' || mode === 'audio') && !!media));

  const publish = async () => {
    if (!canPublish) return;
    setPublishing(true);
    setError(null);
    try {
      const caption = text.trim() || undefined;
      if (mode === 'text') {
        await storyService.create({
          media_type: 'text' as StoryMediaType,
          caption,
          background_color: bg,
          font,
          audience,
          duration_sec: Math.min(30, Math.max(5, Math.ceil((caption?.length ?? 0) / 20))),
        });
      } else if (media) {
        await storyService.create({
          media_type: media.media_type as StoryMediaType,
          media_url: media.url,
          thumbnail_url: media.thumbnail_url ?? undefined,
          caption,
          background_color: media.media_type === 'audio' ? bg : undefined,
          font: media.media_type === 'audio' ? font : undefined,
          audio_url: media.media_type === 'audio' ? media.url : undefined,
          audience,
          duration_sec:
            media.media_type === 'video' || media.media_type === 'audio'
              ? Math.min(120, Math.max(3, Math.round(media.duration_sec ?? 15)))
              : 6,
        });
      }
      await reload();
      navigation.goBack();
    } catch (e) {
      console.warn('[story] publish failed:', e);
      setError(t('errors.generic'));
      setPublishing(false);
    }
  };

  const rootBg = mode === 'photo' || mode === 'video' ? '#000' : bg;

  return (
    <View style={[styles.root, { backgroundColor: rootBg, paddingTop: insets.top }]}>
      {/* Header */}
      <View style={styles.header}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>

        <View style={styles.modes}>
          {(['text', 'photo', 'video', 'audio'] as Mode[]).map((m) => (
            <Pressable
              key={m}
              onPress={() => onModePress(m)}
              style={[styles.modeBtn, mode === m && styles.modeBtnActive]}
            >
              <Icon
                name={
                  m === 'text'
                    ? 'format-text'
                    : m === 'photo'
                      ? 'image-outline'
                      : m === 'video'
                        ? 'video-outline'
                        : 'microphone'
                }
                size={18}
                color="#fff"
              />
            </Pressable>
          ))}
        </View>

        {mode === 'text' || mode === 'audio' ? (
          <Pressable
            onPress={() => {
              const i = STORY_FONTS.findIndex((f) => f.key === font);
              setFont(STORY_FONTS[(i + 1) % STORY_FONTS.length]!.key);
            }}
            hitSlop={12}
            style={styles.iconBtn}
          >
            <Text style={[styles.fontToggle, fStyle]}>Aa</Text>
          </Pressable>
        ) : (
          <View style={styles.iconBtn} />
        )}
      </View>

      {/* Canvas */}
      <View style={styles.canvas}>
        {mode === 'text' ? (
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('stories.typePlaceholder')}
            placeholderTextColor="#ffffffcc"
            multiline
            autoFocus
            maxLength={700}
            style={[styles.input, fStyle]}
            selectionColor="#fff"
          />
        ) : mode === 'photo' && media ? (
          <Image source={{ uri: mediaUrl(media.url) }} style={styles.preview} resizeMode="contain" />
        ) : mode === 'video' && media ? (
          <View style={styles.mediaFallback}>
            {media.thumbnail_url ? (
              <Image source={{ uri: mediaUrl(media.thumbnail_url) }} style={styles.preview} resizeMode="contain" />
            ) : (
              <Icon name="video" size={72} color="#ffffffcc" />
            )}
            <View style={styles.playPill}>
              <Icon name="play" size={16} color="#fff" />
              <Text style={styles.playPillText}>
                {Math.round(media.duration_sec ?? 0)}s
              </Text>
            </View>
          </View>
        ) : mode === 'audio' ? (
          <View style={styles.mediaFallback}>
            <View style={styles.audioBadge}>
              <Icon
                name={picker.recording ? 'stop' : media ? 'music-note' : 'microphone'}
                size={40}
                color="#fff"
              />
            </View>
            <Text style={styles.audioLabel}>
              {picker.recording
                ? `${t('stories.recording')} ${picker.recordSeconds}s`
                : media
                  ? `${t('stories.audioTrack')} · ${Math.round(media.duration_sec ?? 0)}s`
                  : t('stories.tapMicToRecord')}
            </Text>
            {!media && !picker.recording ? (
              <Pressable onPress={toggleRecord} style={styles.recordBtn}>
                <Text style={styles.recordBtnText}>{t('stories.startRecording')}</Text>
              </Pressable>
            ) : null}
            {picker.recording ? (
              <Pressable onPress={toggleRecord} style={[styles.recordBtn, styles.recordStop]}>
                <Text style={styles.recordBtnText}>{t('stories.stopRecording')}</Text>
              </Pressable>
            ) : null}
          </View>
        ) : (
          <View style={styles.mediaFallback}>
            {picker.busy ? (
              <ActivityIndicator color="#fff" size="large" />
            ) : (
              <>
                <Icon
                  name={mode === 'video' ? 'video-plus-outline' : 'image-plus'}
                  size={56}
                  color="#ffffffcc"
                />
                <View style={styles.pickRow}>
                  <Pressable
                    onPress={() => (mode === 'video' ? chooseVideo(false) : chooseImage(false))}
                    style={styles.pickBtn}
                  >
                    <Icon name="image-multiple-outline" size={18} color="#fff" />
                    <Text style={styles.pickBtnText}>{t('stories.fromGallery')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => (mode === 'video' ? chooseVideo(true) : chooseImage(true))}
                    style={styles.pickBtn}
                  >
                    <Icon name="camera-outline" size={18} color="#fff" />
                    <Text style={styles.pickBtnText}>{t('stories.fromCamera')}</Text>
                  </Pressable>
                </View>
              </>
            )}
          </View>
        )}
      </View>

      {/* Légende (média) */}
      {mode !== 'text' && media ? (
        <View style={styles.captionWrap}>
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder={t('stories.captionPlaceholder')}
            placeholderTextColor="#ffffffcc"
            maxLength={500}
            style={styles.captionInput}
            selectionColor="#fff"
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {/* Barre de couleurs (texte / audio) */}
      {mode === 'text' || mode === 'audio' ? (
        <View style={styles.swatches}>
          {STORY_BG_COLORS.map((color) => (
            <Pressable
              key={color}
              onPress={() => setBg(color)}
              style={[styles.swatch, { backgroundColor: color }, bg === color && styles.swatchActive]}
            />
          ))}
        </View>
      ) : null}

      {/* Pied : audience + envoyer */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          onPress={() => setAudience((a) => (a === 'everyone' ? 'contacts' : 'everyone'))}
          style={styles.audienceBtn}
        >
          <Icon
            name={audience === 'everyone' ? 'earth' : 'account-multiple-outline'}
            size={16}
            color="#fff"
          />
          <Text style={styles.audienceText}>
            {audience === 'everyone' ? t('stories.audienceEveryone') : t('stories.audienceContacts')}
          </Text>
        </Pressable>

        <Pressable
          onPress={publish}
          disabled={!canPublish}
          style={[styles.send, { opacity: canPublish ? 1 : 0.5 }]}
        >
          {busy ? (
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
  fontToggle: { color: '#fff', fontSize: 18 },
  modes: { flexDirection: 'row', gap: 6 },
  modeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  modeBtnActive: { backgroundColor: 'rgba(255,255,255,0.22)' },
  canvas: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  input: { color: '#fff', fontSize: 26, textAlign: 'center', width: '100%', maxHeight: '80%' },
  preview: { width: '100%', height: '100%' },
  mediaFallback: { alignItems: 'center', gap: 16 },
  playPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
  },
  playPillText: { color: '#fff', fontWeight: '700', fontSize: 12 },
  audioBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  recordBtn: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: 22,
  },
  recordStop: { backgroundColor: '#E5484D' },
  recordBtnText: { color: '#12213B', fontWeight: '800' },
  pickRow: { flexDirection: 'row', gap: 12 },
  pickBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1.5,
    borderColor: '#ffffff88',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  pickBtnText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  captionWrap: { paddingHorizontal: 20, paddingBottom: 6 },
  captionInput: {
    color: '#fff',
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff55',
    paddingVertical: 8,
  },
  error: { color: '#fff', textAlign: 'center', marginBottom: 8, fontWeight: '600' },
  swatches: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    justifyContent: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  swatch: { width: 32, height: 32, borderRadius: 16, borderWidth: 2, borderColor: '#ffffff44' },
  swatchActive: { borderColor: '#fff', transform: [{ scale: 1.18 }] },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  audienceBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#ffffff66',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  audienceText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  send: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
