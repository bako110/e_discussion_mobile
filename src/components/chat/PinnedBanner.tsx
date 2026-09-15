/**
 * Bandeau des messages épinglés (jusqu'à 3), en haut du chat — façon
 * WhatsApp. Affichage seul pour l'instant : taper sur un point permet de
 * changer l'aperçu affiché, mais ne fait pas défiler la liste jusqu'au
 * message (nécessiterait de retrouver/recharger le message dans
 * l'historique paginé — hors scope pour l'instant).
 */
import React, { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { PinnedMessage } from '@/types';

function previewLabel(p: PinnedMessage, t: (k: string) => string): string {
  if (p.message?.body) return p.message.body;
  switch (p.message?.type) {
    case 'image':
      return t('conversations.photo');
    case 'video':
      return t('conversations.video');
    case 'voice':
      return t('conversations.voiceMessage');
    case 'file':
      return t('conversations.file');
    case 'location':
      return t('conversations.location');
    default:
      return '';
  }
}

interface Props {
  pinned: PinnedMessage[];
}

export const PinnedBanner: React.FC<Props> = ({ pinned }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;
  const [index, setIndex] = useState(0);

  if (pinned.length === 0) return null;
  const shown = pinned[Math.min(index, pinned.length - 1)]!;

  return (
    <View style={[styles.wrap, { backgroundColor: c.surfaceAlt, borderBottomColor: c.divider }]}>
      <Icon name="pin" size={15} color={c.primary} />
      <View style={styles.body}>
        <Text style={[styles.preview, { color: c.text }]} numberOfLines={1}>
          {previewLabel(shown, t)}
        </Text>
      </View>
      {pinned.length > 1 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.dotsWrap}
          contentContainerStyle={styles.dotsRow}
        >
          {pinned.map((p, i) => (
            <Pressable
              key={p.id}
              onPress={() => setIndex(i)}
              style={[
                styles.dot,
                { backgroundColor: i === index ? c.primary : c.border },
              ]}
            />
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  body: { flex: 1 },
  preview: { fontSize: 13, fontWeight: '500' },
  dotsWrap: { maxWidth: 40 },
  dotsRow: { gap: 4, alignItems: 'center' },
  dot: { width: 6, height: 6, borderRadius: 3 },
});
