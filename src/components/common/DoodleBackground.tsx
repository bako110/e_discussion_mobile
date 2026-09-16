/**
 * Fond décoratif à petites icônes éparses — façon Telegram (les « doodles »
 * de fond) : bulles de message, cœurs, étoiles, points, disposés en grille
 * légèrement décalée d'une ligne à l'autre, très discrets (faible opacité,
 * couleur dérivée du thème). S'adapte automatiquement au clair/sombre.
 *
 * Pur SVG (react-native-svg, déjà utilisé ailleurs dans l'app) — aucune
 * dépendance supplémentaire, aucun asset image à charger.
 */
import React, { useMemo } from 'react';
import { StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';

import { useTheme } from '@/context/ThemeContext';

/** Une tuile = une ligne de motifs espacés ; les lignes impaires sont
 * décalées d'une demi-largeur pour éviter l'effet de grille trop régulière. */
const TILE = 64;
const ICONS = ['bubble', 'heart', 'star', 'dot'] as const;
type IconKind = (typeof ICONS)[number];

/** Petites formes simples dessinées au trait (stroke), pas remplies — plus
 * discret et cohérent quel que soit le fond derrière. */
function DoodleIcon({ kind, x, y, color }: { kind: IconKind; x: number; y: number; color: string }) {
  const common = { stroke: color, strokeWidth: 2.6, fill: 'none' as const, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'bubble':
      return (
        <Path
          d={`M${x - 7},${y - 5} h14 a4,4 0 0 1 4,4 v4 a4,4 0 0 1 -4,4 h-8 l-4,4 v-4 h-2 a4,4 0 0 1 -4,-4 v-4 a4,4 0 0 1 4,-4 z`}
          {...common}
        />
      );
    case 'heart':
      return (
        <Path
          d={`M${x},${y + 7} C${x - 10},${y - 1} ${x - 8},${y - 9} ${x},${y - 4} C${x + 8},${y - 9} ${x + 10},${y - 1} ${x},${y + 7} z`}
          {...common}
        />
      );
    case 'star': {
      const pts = Array.from({ length: 5 }, (_, i) => {
        const a = (Math.PI * 2 * i) / 5 - Math.PI / 2;
        const r = i % 2 === 0 ? 8 : 3.5;
        return `${x + r * Math.cos(a)},${y + r * Math.sin(a)}`;
      });
      return <Path d={`M${pts.join(' L')} z`} {...common} />;
    }
    case 'dot':
      return <Circle cx={x} cy={y} r={3.4} fill={color} stroke="none" />;
  }
}

interface Props {
  /** Opacité globale du motif — reste volontairement très faible par défaut
   * pour ne jamais gêner la lecture du contenu au premier plan. */
  opacity?: number;
}

const DoodleBackgroundBase: React.FC<Props> = ({ opacity = 0.3 }) => {
  const { theme } = useTheme();
  const { width, height } = useWindowDimensions();
  // couleur PRIMAIRE (pas le gris neutre `text`) : certains appareils
  // (filtres « confort oculaire »/ajustement colorimétrique fréquents sur
  // Transsion/Lenovo) aplatissent les tons gris clairs à faible contraste
  // avant qu'ils n'atteignent l'écran — une teinte saturée passe au travers.
  const color = theme.colors.primary;

  // recalculé seulement si la taille d'écran ou la couleur (donc le thème)
  // change — jamais à chaque re-render du composant parent.
  const icons = useMemo(() => {
    const cols = Math.ceil(width / TILE) + 1;
    const rows = Math.ceil(height / TILE) + 1;
    const list: { kind: IconKind; x: number; y: number }[] = [];
    for (let row = 0; row < rows; row++) {
      const offset = row % 2 === 0 ? 0 : TILE / 2;
      for (let col = 0; col < cols; col++) {
        // ordre déterministe (pas Math.random) : rendu stable, pas de
        // re-tirage différent à chaque re-render.
        const kind = ICONS[(row * 3 + col * 7) % ICONS.length]!;
        list.push({
          kind,
          x: col * TILE + offset + TILE / 2,
          y: row * TILE + TILE / 2,
        });
      }
    }
    return list;
  }, [width, height]);

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Svg width={width} height={height} style={{ opacity }}>
        {icons.map((it, i) => (
          <DoodleIcon key={i} kind={it.kind} x={it.x} y={it.y} color={color} />
        ))}
      </Svg>
    </View>
  );
};

export const DoodleBackground = React.memo(DoodleBackgroundBase);
