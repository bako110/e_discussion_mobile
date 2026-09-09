import React, { useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import Svg, { Path } from 'react-native-svg';
import { captureRef } from 'react-native-view-shot';
import ViewShot from 'react-native-view-shot';
import ImagePicker from 'react-native-image-crop-picker';

import { Icon } from '@/components/common';
import {
  DRAW_COLORS,
  STICKER_EMOJIS,
  STORY_BG_COLORS,
} from '@/components/story/storyConfig';
import { useStories } from '@/context/StoriesContext';
import type { MainScreenProps } from '@/navigation/types';
import { mediaService, storyService } from '@/services';
import type { StoryAudience, StoryMediaType } from '@/types';
import { mediaUrl } from '@/utils/media';

type Stroke = { color: string; width: number; d: string };
type Sticker = { id: string; emoji: string; x: number; y: number; scale: number };
type Tool = 'none' | 'draw' | 'text' | 'sticker';

/** Sticker emoji déplaçable au doigt (position relative 0..1). */
const DraggableSticker: React.FC<{
  item: Sticker;
  onMove: (id: string, x: number, y: number) => void;
}> = ({ item, onMove }) => {
  const pos = useRef({ x: item.x, y: item.y });
  const [, force] = useState(0);
  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderMove: (_e, g) => {
          pos.current = {
            x: Math.min(1, Math.max(0, item.x + g.dx / 320)),
            y: Math.min(1, Math.max(0, item.y + g.dy / 480)),
          };
          force((n) => n + 1);
        },
        onPanResponderRelease: () => onMove(item.id, pos.current.x, pos.current.y),
      }),
    // item.x/item.y : base de calcul du drag, capturée à la création du responder
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [item.id],
  );
  return (
    <View
      {...responder.panHandlers}
      style={[
        styles.sticker,
        { left: `${pos.current.x * 100}%`, top: `${pos.current.y * 100}%` },
      ]}
    >
      <Text style={styles.stickerText}>{item.emoji}</Text>
    </View>
  );
};

/**
 * Éditeur média plein écran (façon WhatsApp) :
 *  - recadrer (image-editor natif),
 *  - dessiner au doigt (SVG),
 *  - légende texte,
 *  - stickers emoji déplaçables,
 *  - « Envoyer » : capture la vue annotée -> upload -> publie la story.
 *
 * `route.params.media` vient de useMediaPicker (déjà uploadé une 1re fois — on
 * ré-uploade l'image annotée finale).
 */
export const MediaEditorScreen: React.FC<MainScreenProps<'MediaEditor'>> = ({
  route,
  navigation,
}) => {
  const { media } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { reload } = useStories();

  const shotRef = useRef<React.ElementRef<typeof ViewShot>>(null);

  const isImage = media.media_type === 'image';
  const [imageUri, setImageUri] = useState<string>(mediaUrl(media.url) ?? media.url ?? '');
  const [tool, setTool] = useState<Tool>('none');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [current, setCurrent] = useState<Stroke | null>(null);
  const [drawColor, setDrawColor] = useState(DRAW_COLORS[0]!);
  const [stickers, setStickers] = useState<Sticker[]>([]);
  const [caption, setCaption] = useState('');
  // fond des stories vidéo/audio (pas de canvas image) — non modifiable ici
  const bg = STORY_BG_COLORS[5]!;
  const [audience, setAudience] = useState<StoryAudience>('everyone');
  const [publishing, setPublishing] = useState(false);
  const [cropping, setCropping] = useState(false);

  // ── dessin ────────────────────────────────────────────────────────────
  const drawResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => tool === 'draw',
        onMoveShouldSetPanResponder: () => tool === 'draw',
        onPanResponderGrant: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent({ color: drawColor, width: 5, d: `M ${locationX} ${locationY}` });
        },
        onPanResponderMove: (e) => {
          const { locationX, locationY } = e.nativeEvent;
          setCurrent((s) => (s ? { ...s, d: `${s.d} L ${locationX} ${locationY}` } : s));
        },
        onPanResponderRelease: () => {
          setCurrent((s) => {
            if (s) setStrokes((all) => [...all, s]);
            return null;
          });
        },
      }),
    [tool, drawColor],
  );

  const undoStroke = () => setStrokes((s) => s.slice(0, -1));

  // ── recadrage : éditeur natif interactif (cadre visible, pinch, grille) ──
  const crop = async () => {
    if (!isImage || cropping) return;
    setCropping(true);
    try {
      const res = await ImagePicker.openCropper({
        path: imageUri,
        mediaType: 'photo',
        freeStyleCropEnabled: true, // cadre libre + poignées
        cropperToolbarTitle: t('stories.cropTitle'),
        cropperActiveWidgetColor: '#1E6FE0',
        cropperToolbarColor: '#000000',
        cropperToolbarWidgetColor: '#FFFFFF',
        hideBottomControls: false,
        enableRotationGesture: true,
        compressImageQuality: 0.9,
        // dimensions par défaut du cadre (portrait story)
        width: 1080,
        height: 1350,
      });
      const uri = (res as { path?: string }).path;
      if (uri) setImageUri(uri.startsWith('file://') ? uri : `file://${uri}`);
    } catch (e) {
      // l'utilisateur a annulé -> pas d'erreur
      const msg = String((e as Error)?.message ?? e);
      if (!/cancel/i.test(msg)) console.warn('[editor] crop failed:', e);
    } finally {
      setCropping(false);
    }
  };

  // ── stickers ──────────────────────────────────────────────────────────
  const addSticker = (emoji: string) => {
    setStickers((s) => [
      ...s,
      { id: `${Date.now()}_${s.length}`, emoji, x: 0.5, y: 0.4, scale: 1 },
    ]);
    setTool('none');
  };

  const moveSticker = (id: string, x: number, y: number) =>
    setStickers((all) => all.map((s) => (s.id === id ? { ...s, x, y } : s)));

  // ── publication ───────────────────────────────────────────────────────
  const publish = async () => {
    if (publishing) return;
    setPublishing(true);
    try {
      let finalUrl = media.url ?? '';
      let finalThumb = media.thumbnail_url ?? undefined;

      if (isImage && shotRef.current) {
        // grave dessin + stickers sur l'image -> capture -> ré-upload
        const shotUri = await captureRef(shotRef, { format: 'jpg', quality: 0.9 });
        const up = await mediaService.upload({
          uri: shotUri.startsWith('file://') ? shotUri : `file://${shotUri}`,
          name: `story_${Date.now()}.jpg`,
          type: 'image/jpeg',
        });
        finalUrl = up.url;
        finalThumb = up.thumbnail_url ?? undefined;
      }

      await storyService.create({
        media_type: media.media_type as StoryMediaType,
        media_url: finalUrl,
        thumbnail_url: finalThumb,
        caption: caption.trim() || undefined,
        background_color: isImage ? undefined : bg,
        audio_url: media.media_type === 'audio' ? media.url ?? undefined : undefined,
        audience,
        duration_sec:
          media.media_type === 'video' || media.media_type === 'audio'
            ? Math.min(120, Math.max(3, Math.round(media.duration_sec ?? 15)))
            : 6,
      });
      await reload();
      navigation.navigate('Tabs', { screen: 'StatusTab' });
    } catch (e) {
      console.warn('[editor] publish failed:', e);
      Alert.alert(t('errors.generic'));
      setPublishing(false);
    }
  };

  const canvasBg = isImage ? '#000' : bg;

  return (
    <View style={[styles.root, { backgroundColor: canvasBg }]}>
      {/* Canvas capturable */}
      <ViewShot ref={shotRef} style={styles.canvas} options={{ format: 'jpg', quality: 0.9 }}>
        {isImage ? (
          <Image source={{ uri: imageUri }} style={styles.media} resizeMode="contain" />
        ) : media.media_type === 'video' ? (
          <View style={styles.mediaFallback}>
            {media.thumbnail_url ? (
              <Image
                source={{ uri: mediaUrl(media.thumbnail_url) }}
                style={styles.media}
                resizeMode="contain"
              />
            ) : (
              <Icon name="play-circle" size={72} color="#ffffffcc" />
            )}
          </View>
        ) : (
          <View style={styles.mediaFallback}>
            <View style={styles.audioBadge}>
              <Icon name="microphone" size={44} color="#fff" />
            </View>
          </View>
        )}

        {/* dessin */}
        {isImage ? (
          <View style={StyleSheet.absoluteFill} {...drawResponder.panHandlers} pointerEvents={tool === 'draw' ? 'auto' : 'box-none'}>
            <Svg style={StyleSheet.absoluteFill}>
              {strokes.map((s, i) => (
                <Path key={i} d={s.d} stroke={s.color} strokeWidth={s.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ))}
              {current ? (
                <Path d={current.d} stroke={current.color} strokeWidth={current.width} fill="none" strokeLinecap="round" strokeLinejoin="round" />
              ) : null}
            </Svg>
          </View>
        ) : null}

        {/* stickers */}
        {stickers.map((s) => (
          <DraggableSticker key={s.id} item={s} onMove={moveSticker} />
        ))}

        {/* légende gravée en bas de l'image */}
        {caption.trim() && isImage ? (
          <View style={styles.captionOverlay} pointerEvents="none">
            <Text style={styles.captionOverlayText}>{caption.trim()}</Text>
          </View>
        ) : null}
      </ViewShot>

      {/* Header outils */}
      <View style={[styles.header, { top: insets.top + 4 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <View style={styles.headerRight}>
          {isImage ? (
            <Pressable onPress={crop} hitSlop={10} style={styles.iconBtn}>
              {cropping ? (
                <ActivityIndicator color="#fff" size="small" />
              ) : (
                <Icon name="crop" size={22} color="#fff" />
              )}
            </Pressable>
          ) : null}
          {isImage ? (
            <Pressable
              onPress={() => setTool((x) => (x === 'draw' ? 'none' : 'draw'))}
              hitSlop={10}
              style={[styles.iconBtn, tool === 'draw' && styles.iconBtnActive]}
            >
              <Icon name="draw" size={22} color="#fff" />
            </Pressable>
          ) : null}
          <Pressable
            onPress={() => setTool((x) => (x === 'sticker' ? 'none' : 'sticker'))}
            hitSlop={10}
            style={[styles.iconBtn, tool === 'sticker' && styles.iconBtnActive]}
          >
            <Icon name="sticker-emoji" size={22} color="#fff" />
          </Pressable>
          <Pressable
            onPress={() => setTool((x) => (x === 'text' ? 'none' : 'text'))}
            hitSlop={10}
            style={[styles.iconBtn, tool === 'text' && styles.iconBtnActive]}
          >
            <Icon name="format-text" size={22} color="#fff" />
          </Pressable>
          {strokes.length > 0 ? (
            <Pressable onPress={undoStroke} hitSlop={10} style={styles.iconBtn}>
              <Icon name="undo" size={22} color="#fff" />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Palette couleurs (mode dessin) */}
      {tool === 'draw' ? (
        <View style={[styles.palette, { bottom: 150 + insets.bottom }]}>
          {DRAW_COLORS.map((col) => (
            <Pressable
              key={col}
              onPress={() => setDrawColor(col)}
              style={[
                styles.swatch,
                { backgroundColor: col },
                drawColor === col && styles.swatchActive,
              ]}
            />
          ))}
        </View>
      ) : null}

      {/* Grille stickers */}
      {tool === 'sticker' ? (
        <View style={[styles.stickerGrid, { bottom: 120 + insets.bottom }]}>
          {STICKER_EMOJIS.map((e) => (
            <Pressable key={e} onPress={() => addSticker(e)} style={styles.stickerPick}>
              <Text style={styles.stickerPickText}>{e}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Barre du bas : légende + audience + envoyer */}
      <View style={[styles.bottom, { paddingBottom: 12 + insets.bottom }]}>
        {tool === 'text' || caption.length > 0 ? (
          <TextInput
            value={caption}
            onChangeText={setCaption}
            placeholder={t('stories.captionPlaceholder')}
            placeholderTextColor="#ffffffbb"
            style={styles.captionInput}
            selectionColor="#fff"
            autoFocus={tool === 'text'}
            multiline
          />
        ) : null}

        <View style={styles.bottomRow}>
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
              {audience === 'everyone'
                ? t('stories.audienceEveryone')
                : t('stories.audienceContacts')}
            </Text>
          </Pressable>

          <Pressable
            onPress={publish}
            disabled={publishing}
            style={[styles.send, { opacity: publishing ? 0.6 : 1 }]}
          >
            {publishing ? (
              <ActivityIndicator color="#1E6FE0" />
            ) : (
              <>
                <Text style={styles.sendText}>{t('stories.send')}</Text>
                <Icon name="send" size={18} color="#1E6FE0" />
              </>
            )}
          </Pressable>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1 },
  canvas: { flex: 1 },
  media: { width: '100%', height: '100%' },
  mediaFallback: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  audioBadge: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captionOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 40,
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  captionOverlayText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 10,
    overflow: 'hidden',
  },
  sticker: { position: 'absolute', transform: [{ translateX: -22 }, { translateY: -22 }] },
  stickerText: { fontSize: 44 },
  header: {
    position: 'absolute',
    left: 8,
    right: 8,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    zIndex: 10,
  },
  headerRight: { flexDirection: 'row', gap: 4 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { backgroundColor: 'rgba(255,255,255,0.25)' },
  palette: {
    position: 'absolute',
    left: 16,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    zIndex: 10,
  },
  swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, borderColor: '#ffffff55' },
  swatchActive: { borderColor: '#fff', transform: [{ scale: 1.2 }] },
  stickerGrid: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderRadius: 16,
    padding: 10,
    zIndex: 10,
  },
  stickerPick: { padding: 6 },
  stickerPickText: { fontSize: 30 },
  bottom: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 16, zIndex: 10 },
  captionInput: {
    color: '#fff',
    fontSize: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ffffff55',
    paddingVertical: 8,
    marginBottom: 10,
    maxHeight: 100,
  },
  bottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#fff',
    borderRadius: 24,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendText: { color: '#1E6FE0', fontWeight: '800', fontSize: 15 },
});
