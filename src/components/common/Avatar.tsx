import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';
import { mediaUrl } from '@/utils/media';

interface Props {
  uri?: string | null;
  name?: string | null;
  size?: number;
  online?: boolean;
  /** Anneau coloré (voir `theme.colors.storyRing`) signalant un statut/story
   * non vu(e) de cette personne — même code couleur que dans les listes de
   * conversations et de statuts, pour rester reconnaissable partout. */
  storyRing?: boolean;
}

const PALETTE = ['#2F80ED', '#27AE79', '#7B61FF', '#E0389A', '#E8A13C', '#1B6FE0'];

function initials(name?: string | null): string {
  if (!name) return '?';
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase() ?? '')
    .join('');
}

function colorFor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) & 0xffff;
  return PALETTE[h % PALETTE.length]!;
}

export const Avatar: React.FC<Props> = ({ uri, name, size = 48, online, storyRing }) => {
  const { theme } = useTheme();
  const radius = size / 2;
  const dot = Math.max(10, size * 0.28);
  const resolved = mediaUrl(uri);
  // l'anneau se dessine EN DEHORS de l'avatar (comme les listes existantes) :
  // la taille réelle inclut son épaisseur + un petit espace, l'image garde `size`.
  const ringBorder = Math.max(2, Math.round(size * 0.055));
  const ringGap = Math.max(1, Math.round(size * 0.035));
  const ringBox = size + 2 * (ringBorder + ringGap);

  const avatarContent = (
    <View style={{ width: size, height: size }}>
      {resolved ? (
        <Image source={{ uri: resolved }} style={{ width: size, height: size, borderRadius: radius }} />
      ) : (
        <View
          style={[
            styles.fallback,
            { width: size, height: size, borderRadius: radius, backgroundColor: colorFor(name ?? '?') },
          ]}
        >
          <Text style={{ color: '#fff', fontWeight: '700', fontSize: size * 0.4 }}>
            {initials(name)}
          </Text>
        </View>
      )}
      {online ? (
        <View
          style={[
            styles.dot,
            {
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: theme.colors.online,
              borderColor: theme.colors.background,
            },
          ]}
        />
      ) : null}
    </View>
  );

  if (!storyRing) return avatarContent;

  return (
    <View
      style={{
        width: ringBox,
        height: ringBox,
        borderRadius: ringBox / 2,
        borderWidth: ringBorder,
        borderColor: theme.colors.storyRing,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {avatarContent}
    </View>
  );
};

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 0, bottom: 0, borderWidth: 2 },
});
