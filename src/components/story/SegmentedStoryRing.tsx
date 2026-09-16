/**
 * Anneau de statut SEGMENTÉ — un arc par story (façon barres de progression
 * du viewer, mais en cercle), au lieu d'un simple cercle de couleur unie.
 * Segment BLANC = story déjà vue, segment coloré (bleu/primary) = non vue.
 * S'il n'y a qu'une seule story, l'anneau reste un cercle plein classique.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

interface Props {
  /** nombre total de stories actives de cet auteur. */
  total: number;
  /** nombre de stories déjà vues (les `seen` premières, dans l'ordre
   * chronologique — cohérent avec le viewer qui les affiche dans cet ordre). */
  seenCount: number;
  size: number;
  strokeWidth?: number;
  /** couleur des segments NON vus (par défaut bleu vif façon WhatsApp). */
  color?: string;
  /** couleur des segments déjà vus. */
  seenColor?: string;
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
}

export const SegmentedStoryRing: React.FC<Props> = ({
  total,
  seenCount,
  size,
  strokeWidth = 2.5,
  color = '#2E9BFF',
  seenColor = 'rgba(255,255,255,0.85)',
  style,
  children,
}) => {
  const r = (size - strokeWidth) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  // petit espace entre segments, proportionnel au nombre de stories (plus il
  // y en a, plus les coupures doivent être fines pour ne pas manger le trait).
  const gapDeg = total > 1 ? Math.min(10, 60 / total) : 0;
  const segDeg = total > 0 ? 360 / total - gapDeg : 360;

  const segments = Array.from({ length: Math.max(1, total) }, (_, i) => {
    const isSeen = i < seenCount;
    const startDeg = i * (360 / Math.max(1, total)) - 90; // -90 : démarre en haut
    const dash = (segDeg / 360) * circumference;
    const gap = circumference - dash;
    return { isSeen, startDeg, dash, gap, key: i };
  });

  return (
    <View style={[{ width: size, height: size }, style]}>
      <Svg width={size} height={size} style={{ position: 'absolute' }}>
        {segments.map((s) => (
          <Circle
            key={s.key}
            cx={cx}
            cy={cy}
            r={r}
            stroke={s.isSeen ? seenColor : color}
            strokeWidth={strokeWidth}
            strokeDasharray={`${s.dash} ${s.gap}`}
            strokeLinecap="round"
            fill="none"
            rotation={s.startDeg}
            origin={`${cx}, ${cy}`}
          />
        ))}
      </Svg>
      {children}
    </View>
  );
};
