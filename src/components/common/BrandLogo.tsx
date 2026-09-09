import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '@/context/ThemeContext';

const MARK = require('@/assets/logo_mark.png');
const FULL = require('@/assets/logo_e_discussion.png');

interface Props {
  /** Taille du symbole (les bulles). */
  size?: number;
  /** `mark` = bulles seules · `stacked` = bulles + mot dessous · `full` = image complete (avec le mot integre). */
  variant?: 'mark' | 'stacked' | 'full';
}

/** Logo E-discussion — s'appuie sur les assets bitmap officiels
 * (`src/assets/logo_e_discussion.png` et son mark decoupe). */
export const BrandLogo: React.FC<Props> = ({ size = 96, variant = 'stacked' }) => {
  const { theme } = useTheme();

  if (variant === 'full') {
    return (
      <Image
        source={FULL}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="E-discussion"
      />
    );
  }

  return (
    <View style={styles.wrap}>
      <Image
        source={MARK}
        style={{ width: size, height: size }}
        resizeMode="contain"
        accessibilityLabel="E-discussion"
      />
      {variant === 'stacked' ? (
        <Text style={[styles.word, { color: theme.colors.text }]}>
          <Text style={{ color: theme.colors.primary }}>E</Text>-discussion
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 10 },
  word: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
});
