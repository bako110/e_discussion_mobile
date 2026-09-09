import React from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { StoryFeedItem } from '@/types';

import { mediaUrl } from '@/utils/media';

import { fontStyle, paletteBySeed } from './storyConfig';

export const CARD_W = 78;
export const CARD_H = 112;

interface Props {
  item: StoryFeedItem;
  onPress: () => void;
}

/**
 * Carte de story dans la barre horizontale — style WhatsApp/stream_mobile :
 * fond = miniature ou dégradé, avatar en haut-gauche avec anneau (non vu =
 * couleur primaire, vu = gris), prénom + nombre en bas.
 */
export const StoryCard: React.FC<Props> = ({ item, onPress }) => {
  const { theme } = useTheme();
  const c = theme.colors;

  const last = item.stories[0];
  const name = item.author.display_name || item.author.username || '—';
  const first = name.split(' ')[0] ?? name;
  const seen = !item.has_unseen;
  const ringColor = seen ? c.border : c.primary;

  const thumb = last?.thumbnail_url ?? (last?.media_type === 'image' ? last?.media_url : null);
  const bg = last?.background_color ?? null;
  const isText = last?.media_type === 'text';
  const isVideo = last?.media_type === 'video';
  const isAudio = last?.media_type === 'audio' || last?.media_type === 'voice';
  const [g0, g1] = paletteBySeed(name);

  return (
    <Pressable onPress={onPress} style={styles.wrap}>
      <View style={[styles.ring, { borderColor: ringColor }]}>
        <View style={styles.card}>
          {thumb ? (
            <Image source={{ uri: mediaUrl(thumb) }} style={styles.bg} resizeMode="cover" />
          ) : bg ? (
            <View style={[styles.bg, { backgroundColor: bg }]} />
          ) : (
            <View style={[styles.bg, styles.gradient, { backgroundColor: g0 }]}>
              <View style={[StyleSheet.absoluteFill, { backgroundColor: g1, opacity: 0.4 }]} />
            </View>
          )}

          {isText && last?.caption ? (
            <View style={styles.centerContent}>
              <Text
                style={[styles.textPreview, fontStyle(last.font)]}
                numberOfLines={3}
              >
                {last.caption}
              </Text>
            </View>
          ) : isVideo ? (
            <View style={styles.centerContent}>
              <Icon name="play-circle" size={26} color="rgba(255,255,255,0.9)" />
            </View>
          ) : isAudio ? (
            <View style={styles.centerContent}>
              <Icon name="music-note" size={24} color="rgba(255,255,255,0.9)" />
            </View>
          ) : null}

          {/* dégradé bas pour lisibilité */}
          <View style={styles.shade} />

          {/* avatar */}
          <View style={styles.avatarWrap}>
            {item.author.avatar_url ? (
              <Image source={{ uri: mediaUrl(item.author.avatar_url) }} style={styles.avatar} />
            ) : (
              <View style={[styles.avatarFallback, { backgroundColor: c.primary }]}>
                <Text style={styles.avatarInitial}>{first[0]?.toUpperCase() ?? '?'}</Text>
              </View>
            )}
          </View>

          <Text style={styles.name} numberOfLines={1}>
            {first}
          </Text>
          {item.stories.length > 1 ? (
            <Text style={styles.count}>{item.stories.length}</Text>
          ) : null}
        </View>
      </View>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  wrap: { marginRight: 10 },
  ring: { borderWidth: 2, borderRadius: 16, padding: 2 },
  card: {
    width: CARD_W,
    height: CARD_H,
    borderRadius: 12,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  bg: { ...StyleSheet.absoluteFillObject },
  gradient: { alignItems: 'center', justifyContent: 'center' },
  centerContent: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center', padding: 6 },
  textPreview: { color: '#fff', fontSize: 11, textAlign: 'center' },
  shade: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 48,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  avatarWrap: { position: 'absolute', top: 6, left: 6 },
  avatar: { width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: '#fff' },
  avatarFallback: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarInitial: { color: '#fff', fontSize: 11, fontWeight: '800' },
  name: { color: '#fff', fontSize: 11, fontWeight: '700', paddingHorizontal: 6, paddingBottom: 5 },
  count: { position: 'absolute', top: 6, right: 6, color: '#fff', fontSize: 10, fontWeight: '700' },
});
