/**
 * Écran dédié aux notes d'un rendez-vous — ouvert depuis le bouton « Notes »
 * en haut de AppointmentDetailScreen. Toute la gestion (ajout, visibilité,
 * suppression) vit dans AppointmentNotesSection ; cet écran ne fait
 * qu'apporter le header + le cadre plein écran.
 */
import React from 'react';
import { Pressable, ScrollView, StyleSheet } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen } from '@/components/common';
import { AppointmentNotesSection } from '@/components/chat/AppointmentNotesSection';
import { useTheme } from '@/context/ThemeContext';
import type { MainStackParamList } from '@/navigation/types';

export const AppointmentNotesScreen: React.FC = () => {
  const navigation = useNavigation();
  const route = useRoute<{ key: string; name: string; params: MainStackParamList['AppointmentNotes'] }>();
  const { appointmentId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('appointments.notesSection')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <AppointmentNotesSection appointmentId={appointmentId} />
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
});
