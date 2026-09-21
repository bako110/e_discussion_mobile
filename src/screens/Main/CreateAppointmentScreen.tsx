/**
 * Création d'un RDV — titre, date/heure (pickers natifs), participants
 * (plusieurs, façon groupe). Chaque participant invité reçoit une
 * notification et peut accepter/refuser individuellement.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Icon, Screen, showToast } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav, MainStackParamList } from '@/navigation/types';
import { appointmentService, userService } from '@/services';
import type { UserPublic } from '@/types';
import { selectContacts } from './SelectContactsScreen';

function combineDateAndTime(date: Date, time: Date): Date {
  const out = new Date(date);
  out.setHours(time.getHours(), time.getMinutes(), 0, 0);
  return out;
}

export const CreateAppointmentScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const route = useRoute<{ key: string; name: string; params?: MainStackParamList['CreateAppointment'] }>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [mapUrl, setMapUrl] = useState('');
  const [date, setDate] = useState<Date>(new Date());
  const [time, setTime] = useState<Date>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 1);
    return d;
  });
  const [hasEndTime, setHasEndTime] = useState(false);
  const [endTime, setEndTime] = useState<Date>(() => {
    const d = new Date();
    d.setMinutes(0, 0, 0);
    d.setHours(d.getHours() + 2);
    return d;
  });
  const [openPicker, setOpenPicker] = useState<'date' | 'time' | 'endTime' | null>(null);
  const [participants, setParticipants] = useState<UserPublic[]>([]);
  const [submitting, setSubmitting] = useState(false);

  // pré-remplissage des participants si ouvert depuis une conversation
  const preselected = route.params?.preselectedUserIds;
  const hydrated = React.useRef(false);
  React.useEffect(() => {
    if (hydrated.current || !preselected?.length) return;
    hydrated.current = true;
    (async () => {
      const cache = await userService.readContactsCache().catch(() => []);
      const found = cache.filter((u) => preselected.includes(u.id));
      if (found.length) setParticipants(found);
    })();
  }, [preselected]);

  const pickParticipants = async () => {
    const ids = await selectContacts({
      title: t('appointments.selectParticipants'),
      preselected: participants.map((p) => p.id),
    });
    if (!ids) return;
    const cache = await userService.readContactsCache().catch(() => []);
    setParticipants(cache.filter((u) => ids.includes(u.id)));
  };

  const removeParticipant = (id: string) => {
    setParticipants((prev) => prev.filter((p) => p.id !== id));
  };

  const onPickerChange = (event: DateTimePickerEvent, picked?: Date) => {
    if (Platform.OS === 'android') setOpenPicker(null);
    if (event.type === 'dismissed' || !picked) return;
    if (openPicker === 'date') setDate(picked);
    else if (openPicker === 'time') setTime(picked);
    else if (openPicker === 'endTime') setEndTime(picked);
  };

  const canSubmit = title.trim().length > 0 && participants.length > 0 && !submitting;

  const submit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const scheduledAt = combineDateAndTime(date, time);
      if (scheduledAt.getTime() < Date.now()) {
        showToast(t('appointments.errorPastDate'), { type: 'error' });
        setSubmitting(false);
        return;
      }
      const endsAt = hasEndTime ? combineDateAndTime(date, endTime) : null;
      if (endsAt && endsAt.getTime() <= scheduledAt.getTime()) {
        showToast(t('appointments.errorEndBeforeStart'), { type: 'error' });
        setSubmitting(false);
        return;
      }
      await appointmentService.create({
        title: title.trim(),
        description: description.trim() || undefined,
        location: location.trim() || undefined,
        location_map_url: mapUrl.trim() || undefined,
        scheduled_at: scheduledAt.toISOString(),
        ends_at: endsAt ? endsAt.toISOString() : undefined,
        participant_user_ids: participants.map((p) => p.id),
      });
      showToast(t('appointments.created'), { type: 'success' });
      navigation.goBack();
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('appointments.createTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={[styles.label, { color: c.textMuted }]}>{t('appointments.fieldTitle')}</Text>
        <TextInput
          value={title}
          onChangeText={setTitle}
          placeholder={t('appointments.fieldTitlePlaceholder')}
          placeholderTextColor={c.textFaint}
          style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
        />

        <Text style={[styles.label, { color: c.textMuted }]}>{t('appointments.fieldDescription')}</Text>
        <TextInput
          value={description}
          onChangeText={setDescription}
          placeholder={t('appointments.fieldDescriptionPlaceholder')}
          placeholderTextColor={c.textFaint}
          multiline
          style={[
            styles.input,
            styles.textarea,
            { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
          ]}
        />

        <Text style={[styles.label, { color: c.textMuted }]}>{t('appointments.fieldLocation')}</Text>
        <TextInput
          value={location}
          onChangeText={setLocation}
          placeholder={t('appointments.fieldLocationPlaceholder')}
          placeholderTextColor={c.textFaint}
          style={[styles.input, { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text }]}
        />
        <TextInput
          value={mapUrl}
          onChangeText={setMapUrl}
          placeholder={t('appointments.fieldMapUrlPlaceholder')}
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          keyboardType="url"
          style={[
            styles.input,
            styles.mapInput,
            { backgroundColor: c.surfaceAlt, borderColor: c.border, color: c.text },
          ]}
        />

        <Text style={[styles.label, { color: c.textMuted }]}>{t('appointments.fieldWhen')}</Text>
        <View style={styles.row}>
          <Pressable
            onPress={() => setOpenPicker('date')}
            style={[styles.field, styles.flexField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Icon name="calendar-outline" size={18} color={c.textFaint} />
            <Text style={[styles.fieldTxt, { color: c.text }]}>
              {date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })}
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setOpenPicker('time')}
            style={[styles.field, styles.flexField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Icon name="clock-outline" size={18} color={c.textFaint} />
            <Text style={[styles.fieldTxt, { color: c.text }]}>
              {time.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </Pressable>
        </View>

        {hasEndTime ? (
          <View style={styles.row}>
            <Pressable
              onPress={() => setOpenPicker('endTime')}
              style={[styles.field, styles.flexField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
            >
              <Icon name="clock-check-outline" size={18} color={c.textFaint} />
              <Text style={[styles.fieldTxt, { color: c.text }]}>
                {t('appointments.fieldEndsAt')} {endTime.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </Pressable>
            <Pressable onPress={() => setHasEndTime(false)} hitSlop={8} style={styles.removeEndBtn}>
              <Icon name="close" size={16} color={c.textMuted} />
            </Pressable>
          </View>
        ) : (
          <Pressable onPress={() => setHasEndTime(true)} hitSlop={8} style={styles.addEndBtn}>
            <Icon name="plus" size={14} color={c.primary} />
            <Text style={[styles.addTxt, { color: c.primary }]}>{t('appointments.addEndTime')}</Text>
          </Pressable>
        )}

        <View style={styles.participantsHead}>
          <Text style={[styles.label, { color: c.textMuted, marginBottom: 0 }]}>
            {t('appointments.fieldParticipants')}
          </Text>
          <Pressable onPress={pickParticipants} hitSlop={8}>
            <Text style={[styles.addTxt, { color: c.primary }]}>{t('appointments.addParticipants')}</Text>
          </Pressable>
        </View>

        {participants.length === 0 ? (
          <Text style={[styles.emptyParticipants, { color: c.textFaint }]}>
            {t('appointments.noParticipants')}
          </Text>
        ) : (
          <View style={styles.participantsList}>
            {participants.map((p) => (
              <View key={p.id} style={[styles.participantChip, { backgroundColor: c.surfaceAlt }]}>
                <Avatar uri={p.avatar_url} name={p.display_name} size={22} />
                <Text style={[styles.participantName, { color: c.text }]} numberOfLines={1}>
                  {p.display_name || p.username}
                </Text>
                <Pressable onPress={() => removeParticipant(p.id)} hitSlop={8}>
                  <Icon name="close" size={14} color={c.textMuted} />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      <Pressable
        onPress={submit}
        disabled={!canSubmit}
        style={[styles.submitBtn, { backgroundColor: c.primary, opacity: canSubmit ? 1 : 0.5 }]}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Icon name="calendar-check-outline" size={18} color="#fff" />
            <Text style={styles.submitTxt}>{t('appointments.submit')}</Text>
          </>
        )}
      </Pressable>

      {openPicker ? (
        <DateTimePicker
          value={openPicker === 'date' ? date : openPicker === 'time' ? time : endTime}
          mode={openPicker === 'date' ? 'date' : 'time'}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          is24Hour
          minimumDate={openPicker === 'date' ? new Date() : undefined}
          onChange={onPickerChange}
        />
      ) : null}
      {Platform.OS === 'ios' && openPicker ? (
        <Pressable
          onPress={() => setOpenPicker(null)}
          style={[styles.iosDoneBtn, { backgroundColor: c.primary }]}
        >
          <Text style={styles.submitTxt}>{t('common.done')}</Text>
        </Pressable>
      ) : null}
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 100 },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6, marginTop: 14, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: { borderRadius: 12, borderWidth: 1, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  mapInput: { marginTop: 8 },
  textarea: { minHeight: 70, textAlignVertical: 'top' },
  row: { flexDirection: 'row', gap: 10, marginTop: 10 },
  addEndBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 10, alignSelf: 'flex-start' },
  removeEndBtn: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  flexField: { flex: 1 },
  fieldTxt: { fontSize: 15, fontWeight: '500' },
  participantsHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 14 },
  addTxt: { fontSize: 13, fontWeight: '700' },
  emptyParticipants: { fontSize: 13, marginTop: 10 },
  participantsList: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
  participantChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 18,
    maxWidth: 180,
  },
  participantName: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  submitBtn: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    borderRadius: 26,
  },
  submitTxt: { color: '#fff', fontWeight: '800', fontSize: 15 },
  iosDoneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginHorizontal: 20,
    marginBottom: 12,
    borderRadius: 24,
  },
});
