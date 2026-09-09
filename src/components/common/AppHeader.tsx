import React from 'react';
import { Platform, StatusBar, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useTheme } from '@/context/ThemeContext';

interface Props {
  title?: string;
  /** Rendu perso au centre (remplace `title`). */
  center?: React.ReactNode;
  left?: React.ReactNode;
  right?: React.ReactNode;
  /** Prend TOUTE la largeur de la barre (remplace left/center/right) — pour
   * les en-tetes riches type conversation (retour + avatar + nom + actions). */
  full?: React.ReactNode;
  /** Zone sous la barre de titre, dans le fond bleu (ex: recherche). */
  bottom?: React.ReactNode;
  /** `brand` = bandeau bleu degrade (ecrans racine) · `plain` = surface neutre (ecrans de detail). */
  variant?: 'brand' | 'plain';
  /** Coins bas arrondis (uniquement variant brand). */
  rounded?: boolean;
  /** Barre de titre plus courte (ecrans de detail). */
  compact?: boolean;
  style?: ViewStyle;
}

const BAR_HEIGHT = 54;
const BAR_HEIGHT_COMPACT = 48;

/**
 * En-tete applicatif haut de gamme.
 *
 * - `variant="brand"` : peint SOUS la status bar (edge-to-edge) avec un
 *   degrade bleu, une ombre douce et des coins bas arrondis optionnels.
 *   La status bar passe en contenu clair automatiquement.
 * - `variant="plain"` : fond de la surface, texte normal (ecrans de detail).
 *
 * Le safe-area top est gere ici : les ecrans utilisent `<Screen edges={[]}>`
 * ou `edges={['top']}` selon qu'ils ont ou non ce header.
 */
export const AppHeader: React.FC<Props> = ({
  title,
  center,
  left,
  right,
  full,
  bottom,
  variant = 'brand',
  rounded = true,
  compact = false,
  style,
}) => {
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;
  const brand = variant === 'brand';

  const topPad = insets.top || (Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0);
  const fg = brand ? c.onHeader : c.text;
  const radius = brand && rounded ? 22 : 0;
  // Ombre portee UNIQUEMENT quand l'en-tete "flotte" (coins arrondis). Un
  // bandeau bord-a-bord (ecran conversation) touche le fond : aucune ombre.
  const withShadow = brand && rounded;

  return (
    <>
      <StatusBar
        translucent
        backgroundColor="transparent"
        barStyle={brand ? 'light-content' : theme.isDark ? 'light-content' : 'dark-content'}
        animated
      />
      {/* Couche OMBRE : porte UNIQUEMENT l'ombre (aucun fond — sinon une
          bande de couleur depasse sous le contenu quand radius=0). L'ombre
          n'existe que si l'en-tete "flotte" (coins arrondis). */}
      <View
        style={[
          withShadow && {
            borderBottomLeftRadius: radius,
            borderBottomRightRadius: radius,
            backgroundColor: c.primaryLo,
          },
          withShadow && (theme.isDark ? styles.shadowDark : styles.shadow),
          style,
        ]}
      >
        {/* Couche CONTENU. En-tete FLOTTANT (rounded) : degrade + coins
            arrondis. En-tete BORD-A-BORD (conversation) : bleu UNI, aucune
            couche supplementaire — pas de double teinte disgracieuse. */}
        <View
          style={[
            styles.wrap,
            {
              paddingTop: topPad,
              borderBottomLeftRadius: radius,
              borderBottomRightRadius: radius,
              backgroundColor: brand ? c.primary : c.background,
            },
            !brand && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
          ]}
        >
        {brand && rounded ? (
          <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
            <Defs>
              <LinearGradient id="hdrGrad" x1="0" y1="0" x2="1" y2="1">
                <Stop offset="0" stopColor={c.primaryHi} />
                <Stop offset="0.55" stopColor={c.primary} />
                <Stop offset="1" stopColor={c.primaryLo} />
              </LinearGradient>
            </Defs>
            <Rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              rx={radius}
              ry={radius}
              fill="url(#hdrGrad)"
            />
          </Svg>
        ) : null}

        <View style={[styles.bar, { height: compact ? BAR_HEIGHT_COMPACT : BAR_HEIGHT }]}>
          {full ? (
            <View style={styles.full}>{full}</View>
          ) : (
            <>
              <View style={styles.side}>{left}</View>
              <View style={styles.center}>
                {center ??
                  (title ? (
                    <Text style={[styles.title, { color: fg }]} numberOfLines={1}>
                      {title}
                    </Text>
                  ) : null)}
              </View>
              <View style={[styles.side, styles.sideRight]}>{right}</View>
            </>
          )}
        </View>

        {bottom ? <View style={styles.bottom}>{bottom}</View> : null}
        </View>
      </View>
    </>
  );
};

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden' },
  // Ombre douce et basse — juste assez pour detacher l'en-tete du contenu.
  shadow: {
    elevation: 3,
    shadowColor: '#1B2B4B',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  shadowDark: {
    elevation: 3,
    shadowColor: '#000000',
    shadowOpacity: 0.28,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  bar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14 },
  side: { minWidth: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sideRight: { justifyContent: 'flex-end' },
  center: { flex: 1, alignItems: 'center' },
  full: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  title: { fontSize: 18, fontWeight: '800', letterSpacing: -0.3 },
  bottom: { paddingHorizontal: 14, paddingBottom: 14, paddingTop: 2 },
});
