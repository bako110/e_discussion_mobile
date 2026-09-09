import React from 'react';
import MCI from 'react-native-vector-icons/MaterialCommunityIcons';

import { useTheme } from '@/context/ThemeContext';

interface Props {
  name: string;
  size?: number;
  color?: string;
}

/** Wrapper MaterialCommunityIcons — couleur par défaut = texte du thème. */
export const Icon: React.FC<Props> = ({ name, size = 22, color }) => {
  const { theme } = useTheme();
  return <MCI name={name} size={size} color={color ?? theme.colors.text} />;
};
