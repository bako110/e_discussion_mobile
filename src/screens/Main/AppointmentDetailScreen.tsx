/**
 * Détail d'un RDV : titre, date, description, liste des participants avec
 * leur statut (en attente/accepté/refusé). Actions selon mon rôle :
 *  - participant invité (pending) -> Accepter / Refuser
 *  - organisateur -> Annuler le RDV
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, confirmAlert, showToast } from '@/components/common';
import { onAppointmentEvent } from '@/context/AppointmentSync';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav, MainStackParamList } from '@/navigation/types';
import { appointmentService } from '@/services';
import type { Appointment, ParticipantStatus } from '@/types';

function statusIcon(status: ParticipantStatus): { icon: string; color: (c: Record<string, string>) => string } {
  if (status === 'accepted') return { icon: 'check-circle', color: (c) => c.success };
  if (status === 'declined') return { icon: 'close-circle', color: (c) => c.danger };
  return { icon: 'clock-outline', color: (c) => c.textFaint };
}

export const AppointmentDetailScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const route = useRoute<{ key: string; name: string; params: MainStackParamList['AppointmentDetail'] }>();
  const { appointmentId } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors as unknown as Record<string, string>;

  const [appt, setAppt] = useState<Appointment | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [notesCount, setNotesCount] = useState(0);

  const load = useCallback(async () => {
    try {
      setAppt(await appointmentService.get(appointmentId));
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, [appointmentId, t]);

  // juste le compte, pour le badge du bouton « Notes » — la gestion complète
  // (ajout/visibilité/suppression) vit dans AppointmentNotesScreen.
  useFocusEffect(
    useCallback(() => {
      void appointmentService
        .listNotes(appointmentId)
        .then((notes) => setNotesCount(notes.length))
        .catch(() => undefined);
    }, [appointmentId]),
  );

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  // temps réel : ce RDV mis à jour ailleurs (l'autre participant répond
  // pendant que cet écran est ouvert) rafraîchit l'affichage immédiatement.
  useEffect(
    () =>
      onAppointmentEvent((updated) => {
        if (updated.id === appointmentId) setAppt(updated);
      }),
    [appointmentId],
  );

  const act = async (fn: () => Promise<Appointment>) => {
    setActing(true);
    try {
      setAppt(await fn());
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setActing(false);
    }
  };

  const onCancel = () => {
    confirmAlert(
      t('appointments.cancelConfirmTitle'),
      t('appointments.cancelConfirmBody'),
      () => void act(() => appointmentService.cancel(appointmentId)),
      { confirmText: t('appointments.cancelConfirm'), destructive: true },
    );
  };

  if (loading || !appt) {
    return (
      <Screen edges={[]}>
        <AppHeader
          title={t('appointments.detailTitle')}
          left={
            <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
              <Icon name="arrow-left" size={24} color={c.onHeader} />
            </Pressable>
          }
        />
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      </Screen>
    );
  }

  const when = new Date(appt.scheduled_at);
  const isOrganizer = appt.my_status === 'organizer';
  const isPendingParticipant = appt.my_status === 'pending';
  const cancelled = appt.status === 'cancelled';

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('appointments.detailTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        {cancelled ? (
          <View style={[styles.cancelledBanner, { backgroundColor: c.danger + '18' }]}>
            <Icon name="calendar-remove" size={16} color={c.danger} />
            <Text style={[styles.cancelledTxt, { color: c.danger }]}>{t('appointments.cancelledBanner')}</Text>
          </View>
        ) : null}

        <View style={styles.titleRow}>
          <Text style={[styles.title, { color: c.text }]}>{appt.title}</Text>
          <Pressable
            onPress={() => navigation.navigate('AppointmentNotes', { appointmentId })}
            style={[styles.notesBtn, { backgroundColor: c.primary + '18' }]}
          >
            <Icon name="notebook-outline" size={15} color={c.primary} />
            <Text style={[styles.notesBtnTxt, { color: c.primary }]}>{t('appointments.notesSection')}</Text>
            {notesCount > 0 ? (
              <View style={[styles.notesBadge, { backgroundColor: c.primary }]}>
                <Text style={styles.notesBadgeTxt}>{notesCount}</Text>
              </View>
            ) : null}
          </Pressable>
        </View>
        {appt.description ? (
          <Text style={[styles.description, { color: c.textMuted }]}>{appt.description}</Text>
        ) : null}

        <View style={[styles.infoRow, { borderColor: c.border }]}>
          <Icon name="calendar-outline" size={18} color={c.textFaint} />
          <Text style={[styles.infoTxt, { color: c.text }]}>
            {when.toLocaleDateString(undefined, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
          </Text>
        </View>
        <View style={[styles.infoRow, { borderColor: c.border }]}>
          <Icon name="clock-outline" size={18} color={c.textFaint} />
          <Text style={[styles.infoTxt, { color: c.text }]}>
            {when.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            {appt.ends_at
              ? ` – ${new Date(appt.ends_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`
              : ''}
          </Text>
        </View>
        {appt.location ? (
          <Pressable
            disabled={!appt.location_map_url}
            onPress={() => appt.location_map_url && void Linking.openURL(appt.location_map_url)}
            style={[styles.infoRow, { borderColor: c.border }]}
          >
            <Icon name="map-marker-outline" size={18} color={c.textFaint} />
            <Text
              style={[
                styles.infoTxt,
                styles.infoTxtLocation,
                { color: appt.location_map_url ? c.primary : c.text },
                appt.location_map_url && styles.infoTxtLink,
              ]}
            >
              {appt.location}
            </Text>
          </Pressable>
        ) : null}
        <View style={[styles.infoRow, { borderColor: c.border }]}>
          <Icon name="account-outline" size={18} color={c.textFaint} />
          <Text style={[styles.infoTxt, { color: c.text }]}>
            {t('appointments.organizedBy', { name: appt.organizer.display_name || appt.organizer.username })}
          </Text>
        </View>

        <Text style={[styles.sectionLabel, { color: c.textMuted }]}>
          {t('appointments.participantsCount', { count: appt.participants.length })}
        </Text>
        {appt.participants.map((p) => {
          const st = statusIcon(p.status);
          return (
            <View key={p.id} style={styles.participantRow}>
              <Avatar uri={p.user.avatar_url} name={p.user.display_name} size={38} />
              <Text style={[styles.participantName, { color: c.text }]} numberOfLines={1}>
                {p.user.display_name || p.user.username}
              </Text>
              <Icon name={st.icon} size={18} color={st.color(c)} />
            </View>
          );
        })}
      </ScrollView>

      {!cancelled && isPendingParticipant ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={() => void act(() => appointmentService.decline(appointmentId))}
            disabled={acting}
            style={[styles.actionBtn, styles.declineBtn, { borderColor: c.danger }]}
          >
            <Text style={[styles.declineTxt, { color: c.danger }]}>{t('appointments.decline')}</Text>
          </Pressable>
          <Pressable
            onPress={() => void act(() => appointmentService.accept(appointmentId))}
            disabled={acting}
            style={[styles.actionBtn, { backgroundColor: c.primary }]}
          >
            <Text style={styles.acceptTxt}>{t('appointments.accept')}</Text>
          </Pressable>
        </View>
      ) : null}

      {!cancelled && isOrganizer ? (
        <View style={styles.actionsRow}>
          <Pressable
            onPress={onCancel}
            disabled={acting}
            style={[styles.actionBtn, styles.declineBtn, { borderColor: c.danger }]}
          >
            <Text style={[styles.declineTxt, { color: c.danger }]}>{t('appointments.cancelAppointment')}</Text>
          </Pressable>
        </View>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 16, paddingBottom: 100 },
  cancelledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 14,
  },
  cancelledTxt: { fontSize: 13, fontWeight: '600' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  title: { flex: 1, fontSize: 20, fontWeight: '800' },
  notesBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 14,
  },
  notesBtnTxt: { fontSize: 12.5, fontWeight: '700' },
  notesBadge: {
    minWidth: 17,
    height: 17,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  notesBadgeTxt: { color: '#fff', fontSize: 10, fontWeight: '800' },
  description: { fontSize: 14, lineHeight: 20, marginBottom: 14 },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  infoTxt: { fontSize: 14.5, fontWeight: '500', textTransform: 'capitalize' },
  infoTxtLocation: { textTransform: 'none', flexShrink: 1 },
  infoTxtLink: { textDecorationLine: 'underline' },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginTop: 18,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  participantRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8 },
  participantName: { flex: 1, fontSize: 15, fontWeight: '500' },
  actionsRow: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    gap: 10,
  },
  actionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
    borderRadius: 26,
  },
  declineBtn: { borderWidth: 1.5, backgroundColor: 'transparent' },
  declineTxt: { fontWeight: '800', fontSize: 14.5 },
  acceptTxt: { color: '#fff', fontWeight: '800', fontSize: 14.5 },
});
