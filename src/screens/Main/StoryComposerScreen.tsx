import React, { useEffect, useMemo, useState } from 'react';
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
import Video from 'react-native-video';
import { launchImageLibrary, type PhotoQuality } from 'react-native-image-picker';

import { Icon, alertError } from '@/components/common';
import {
  STORY_BG_COLORS,
  STORY_FONTS,
  fontStyle,
} from '@/components/story/storyConfig';
import { useStories } from '@/context/StoriesContext';
import { useMediaPicker, type LocalMediaFile } from '@/hooks/useMediaPicker';
import type { MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { StoryAudienceMode } from '@/services/storyService';
import { openStoryPrivacySheet } from '@/services/storyPrivacySheet';
import { getVoiceState, stopVoice, subscribeVoice, toggleVoice } from '@/services/voicePlayer';
import type { UploadedMedia } from '@/services';
import type { StoryMediaType } from '@/types';
import { mediaUrl } from '@/utils/media';

/** Sélection multi-image de statuts (façon WhatsApp) : jusqu'à 12 photos. */
const MAX_MULTI_STORY_IMAGES = 12;

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
  // confidentialité GLOBALE des statuts (écran StoryPrivacy) — affichée ici
  const [audienceMode, setAudienceMode] = useState<StoryAudienceMode>(
    () => storyService.readAudienceCache().mode,
  );
  useEffect(() => {
    const unsub = navigation.addListener('focus', () =>
      setAudienceMode(storyService.readAudienceCache().mode),
    );
    return unsub;
  }, [navigation]);
  const [media, setMedia] = useState<UploadedMedia | null>(null);
  // sélection multi-image (galerie, jusqu'à 12 photos) en cours de résolution
  const [multiPickBusy, setMultiPickBusy] = useState(false);
  // aperçu vidéo : pause/lecture au tap (démarre en lecture, comme un aperçu).
  const [videoPaused, setVideoPaused] = useState(false);
  // aperçu audio : suit le lecteur singleton partagé (celui des vocaux de chat).
  const [, forceAudioRender] = useState(0);
  useEffect(() => subscribeVoice(() => forceAudioRender((n) => n + 1)), []);
  // coupe l'aperçu audio en quittant l'écran (retour arrière, navigation vers
  // l'éditeur média…) — sinon le son continue en fond.
  useEffect(() => () => void stopVoice(), []);
  const audioUrl = media?.media_type === 'audio' ? mediaUrl(media.url) : null;
  const voiceState = getVoiceState();
  const audioPreviewPlaying = !!audioUrl && voiceState.url === audioUrl && voiceState.playing;

  const fStyle = useMemo(() => fontStyle(font), [font]);
  // la publication est LOCAL-FIRST (instantanée, jamais bloquante) — seul
  // l'enregistrement audio en cours occupe l'écran.
  const busy = picker.busy || multiPickBusy;

  // Après sélection d'un média : on passe direct à l'éditeur plein écran
  // SANS uploader (recadrage / dessin / légende / stickers). L'upload se fait
  // seulement à la publication — comme WhatsApp.
  const chooseVideo = async (camera: boolean) => {
    const local = await picker.pickVideoLocal({ camera });
    if (local) navigation.replace('MediaEditor', { local });
  };

  /** Caméra (photo unique) : reste single-image, la galerie multi-sélection
   * n'a de sens que pour la bibliothèque. */
  const chooseImageFromCamera = async () => {
    const local = await picker.pickImageLocal({ camera: true });
    if (local) navigation.replace('MediaEditor', { local });
  };

  // Sélection galerie (icône Photo, ou bouton "Galerie" du fallback) : le
  // picker natif permet directement de cocher plusieurs photos (jusqu'à 12),
  // façon WhatsApp « partager plusieurs photos ». Implémenté directement ici
  // (pas via useMediaPicker, actuellement modifié par une session parallèle
  // sur un flux multi-image DIFFÉRENT) : appelle `launchImageLibrary` avec
  // `selectionLimit` et construit les `LocalMediaFile` du même format que
  // `pickImageLocal`. Une seule photo cochée -> éditeur complet comme avant ;
  // plusieurs -> carrousel multi-image.
  const chooseImagesFromGallery = async () => {
    setMultiPickBusy(true);
    try {
      const res = await launchImageLibrary({
        mediaType: 'photo',
        quality: 0.85 as PhotoQuality,
        selectionLimit: MAX_MULTI_STORY_IMAGES,
        includeExtra: true,
      });
      if (res.didCancel) return;
      if (res.errorCode) {
        alertError('Erreur', res.errorMessage || res.errorCode);
        return;
      }
      const assets = (res.assets ?? []).slice(0, MAX_MULTI_STORY_IMAGES);
      const locals: LocalMediaFile[] = [];
      for (const asset of assets) {
        if (!asset.uri) continue;
        const name = asset.fileName || asset.uri.split('/').pop() || `upload_${Date.now()}`;
        locals.push({
          file: { uri: asset.uri, name, type: asset.type || 'image/jpeg' },
          kind: 'image',
          size: asset.fileSize ?? null,
          width: asset.width ?? null,
          height: asset.height ?? null,
          durationSec: null,
        });
      }
      if (locals.length === 0) return;
      // une seule image sélectionnée : autant réutiliser l'éditeur complet
      // (recadrage / dessin / stickers), pas besoin du carrousel multi-image.
      if (locals.length === 1) {
        navigation.replace('MediaEditor', { local: locals[0]! });
      } else {
        navigation.replace('MultiStoryComposer', { locals });
      }
    } catch (e) {
      console.warn('[stories] multi image pick failed:', e);
      alertError('Erreur', 'Impossible de sélectionner ces photos.');
    } finally {
      setMultiPickBusy(false);
    }
  };

  const toggleRecord = async () => {
    if (picker.recording) {
      const local = await picker.stopRecordingLocal();
      if (local) navigation.replace('MediaEditor', { local });
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
    if (m === 'photo') void chooseImagesFromGallery();
    else if (m === 'video') void chooseVideo(false);
    else void toggleRecord();
  };

  const canPublish =
    !busy &&
    ((mode === 'text' && text.trim().length > 0) ||
      ((mode === 'photo' || mode === 'video' || mode === 'audio') && !!media));

  // LOCAL-FIRST (comme un message) : la story ⏱ apparaît tout de suite dans
  // « Mes statuts », la publication réelle part par l'outbox et se rejoue
  // au retour du réseau — jamais bloquant, jamais d'échec réseau ici.
  // (photo/vidéo/audio publient depuis MediaEditorScreen, seul le texte est
  // géré directement dans cet écran.)
  const publish = () => {
    if (!canPublish || mode !== 'text') return;
    const caption = text.trim() || undefined;
    storyService.createText({
      media_type: 'text' as StoryMediaType,
      caption,
      background_color: bg,
      font,
      duration_sec: Math.min(30, Math.max(5, Math.ceil((caption?.length ?? 0) / 20))),
    });
    void reload();
    navigation.goBack();
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
              {multiPickBusy && m === 'photo' ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
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
              )}
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
          // Aperçu vidéo — lecture réelle (avec le son), tap pour pause/reprise,
          // au lieu de la simple vignette + pastille "▶ Xs" d'avant.
          <Pressable
            style={styles.videoPreviewWrap}
            onPress={() => setVideoPaused((p) => !p)}
          >
            <Video
              source={{ uri: mediaUrl(media.url) ?? media.url }}
              style={styles.preview}
              resizeMode="contain"
              paused={videoPaused}
              repeat
              muted={false}
              poster={media.thumbnail_url ? mediaUrl(media.thumbnail_url) ?? undefined : undefined}
            />
            {videoPaused ? (
              <View style={styles.videoPauseOverlay} pointerEvents="none">
                <Icon name="play" size={44} color="#fff" />
              </View>
            ) : null}
          </Pressable>
        ) : mode === 'audio' ? (
          <View style={styles.mediaFallback}>
            <Pressable
              style={styles.audioBadge}
              disabled={!media}
              onPress={() => {
                if (!audioUrl) return;
                void toggleVoice(audioUrl, {
                  conversationId: null,
                  title: t('stories.audioTrack'),
                  durationMs: media?.duration_sec ? media.duration_sec * 1000 : null,
                });
              }}
            >
              <Icon
                name={
                  picker.recording
                    ? 'stop'
                    : audioPreviewPlaying
                      ? 'pause'
                      : media
                        ? 'play'
                        : 'microphone'
                }
                size={40}
                color="#fff"
              />
            </Pressable>
            <Text style={styles.audioLabel}>
              {picker.recording
                ? `${t('stories.recording')} ${picker.recordSeconds}s`
                : media
                  ? `${t('stories.audioTrack')} · ${Math.round(media.duration_sec ?? 0)}s`
                  : t('stories.tapMicToRecord')}
            </Text>
            {media && audioPreviewPlaying && voiceState.duration > 0 ? (
              <View style={styles.audioTrack}>
                <View
                  style={[
                    styles.audioTrackFill,
                    { width: `${Math.min(100, (voiceState.position / voiceState.duration) * 100)}%` },
                  ]}
                />
              </View>
            ) : null}
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
                    onPress={() =>
                      mode === 'video' ? chooseVideo(false) : chooseImagesFromGallery()
                    }
                    style={styles.pickBtn}
                  >
                    <Icon name="image-multiple-outline" size={18} color="#fff" />
                    <Text style={styles.pickBtnText}>{t('stories.fromGallery')}</Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      mode === 'video' ? chooseVideo(true) : chooseImageFromCamera()
                    }
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

      {/* Pied : confidentialité + envoyer */}
      <View style={[styles.footer, { paddingBottom: 12 + insets.bottom }]}>
        <Pressable
          onPress={() =>
            openStoryPrivacySheet(() =>
              setAudienceMode(storyService.readAudienceCache().mode),
            )
          }
          style={styles.audienceBtn}
        >
          <Icon
            name={
              audienceMode === 'only'
                ? 'account-lock-outline'
                : audienceMode === 'contacts_except'
                  ? 'account-cancel-outline'
                  : 'account-multiple-outline'
            }
            size={16}
            color="#fff"
          />
          <Text style={styles.audienceText}>{t(`storyPrivacy.mode_${audienceMode}`)}</Text>
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
  videoPreviewWrap: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  videoPauseOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  audioBadge: {
    width: 96,
    height: 96,
    borderRadius: 48,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  audioLabel: { color: '#fff', fontSize: 15, fontWeight: '700' },
  audioTrack: {
    width: 180,
    height: 3,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  audioTrackFill: { height: 3, backgroundColor: '#fff' },
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
