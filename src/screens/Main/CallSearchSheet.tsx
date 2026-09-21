/**
 * Bottom sheet de recherche d'appels par date précise + plage horaire
 * optionnelle. Sélection au tap via les pickers natifs Android/iOS
 * (calendrier pour la date, horloge pour les heures) — raccourcis courants
 * en plus pour les cas les plus fréquents (aujourd'hui/hier/semaine).
 */
import React, { useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';

export interface CallDateFilter {
  /** Début du jour ciblé, en ms epoch (00:00:00 local). */
  dayStart: number;
  /** Fin du jour ciblé, en ms epoch (23:59:59.999 local). */
  dayEnd: number;
  /** Heure de début de la plage, en minutes depuis minuit (0-1439), ou null. */
  fromMin: number | null;
  /** Heure de fin de la plage, en minutes depuis minuit (0-1439), ou null. */
  toMin: number | null;
}

function startOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}
function endOfDay(d: Date): number {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x.getTime();
}

function formatDate(d: Date): string {
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}
function formatTime(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
function minutesFromDate(d: Date): number {
  return d.getHours() * 60 + d.getMinutes();
}

export const CallSearchSheet: React.FC<{
  visible: boolean;
  onClose: () => void;
  onApply: (filter: CallDateFilter) => void;
  onReset: () => void;
  hasActiveFilter: boolean;
}> = ({ visible, onClose, onApply, onReset, hasActiveFilter }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [day, setDay] = useState<Date | null>(null);
  const [fromMin, setFromMin] = useState<number | null>(null);
  const [toMin, setToMin] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openPicker, setOpenPicker] = useState<'date' | 'from' | 'to' | null>(null);

  const shortcut = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(0, 0, 0, 0);
    setDay(d);
    setError(null);
  };

  const onPickerChange = (event: DateTimePickerEvent, picked?: Date) => {
    // Android ferme le dialog tout seul après le choix (ou l'annulation) ;
    // iOS reste ouvert (spinner inline) — voir onClose du picker pour ce cas.
    if (Platform.OS === 'android') setOpenPicker(null);
    if (event.type === 'dismissed' || !picked) return;
    if (openPicker === 'date') setDay(picked);
    else if (openPicker === 'from') setFromMin(minutesFromDate(picked));
    else if (openPicker === 'to') setToMin(minutesFromDate(picked));
    setError(null);
  };

  const apply = () => {
    if (!day) {
      setError(t('calls.searchInvalidDate'));
      return;
    }
    if (fromMin !== null && toMin !== null && fromMin > toMin) {
      setError(t('calls.searchInvalidRange'));
      return;
    }
    setError(null);
    onApply({ dayStart: startOfDay(day), dayEnd: endOfDay(day), fromMin, toMin });
    onClose();
  };

  const reset = () => {
    setDay(null);
    setFromMin(null);
    setToMin(null);
    setError(null);
    onReset();
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: c.card, paddingBottom: 16 + insets.bottom },
        ]}
      >
        <View style={styles.handle} />
        <Text style={[styles.title, { color: c.text }]}>{t('calls.searchTitle')}</Text>

        <View style={styles.shortcuts}>
          {[
            { label: t('common.today'), days: 0 },
            { label: t('common.yesterday'), days: 1 },
            { label: t('calls.searchThisWeek'), days: 7 },
          ].map((s) => (
            <Pressable
              key={s.label}
              onPress={() => shortcut(s.days)}
              style={[styles.chip, { borderColor: c.border }]}
            >
              <Text style={[styles.chipTxt, { color: c.text }]}>{s.label}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={[styles.label, { color: c.textMuted }]}>{t('calls.searchDate')}</Text>
        <Pressable
          onPress={() => setOpenPicker('date')}
          style={[styles.field, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
        >
          <Icon name="calendar-outline" size={18} color={c.textFaint} />
          <Text style={[styles.input, { color: day ? c.text : c.textFaint }]}>
            {day ? formatDate(day) : 'JJ/MM/AAAA'}
          </Text>
        </Pressable>

        <Text style={[styles.label, { color: c.textMuted }]}>{t('calls.searchTimeRange')}</Text>
        <View style={styles.timeRow}>
          <Pressable
            onPress={() => setOpenPicker('from')}
            style={[styles.field, styles.timeField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Icon name="clock-outline" size={18} color={c.textFaint} />
            <Text style={[styles.input, { color: fromMin !== null ? c.text : c.textFaint }]}>
              {fromMin !== null ? formatTime(fromMin) : 'HH:MM'}
            </Text>
          </Pressable>
          <Text style={{ color: c.textMuted }}>—</Text>
          <Pressable
            onPress={() => setOpenPicker('to')}
            style={[styles.field, styles.timeField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
          >
            <Icon name="clock-outline" size={18} color={c.textFaint} />
            <Text style={[styles.input, { color: toMin !== null ? c.text : c.textFaint }]}>
              {toMin !== null ? formatTime(toMin) : 'HH:MM'}
            </Text>
          </Pressable>
        </View>

        {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

        <View style={styles.actions}>
          {hasActiveFilter ? (
            <Pressable onPress={reset} style={[styles.btn, styles.btnGhost, { borderColor: c.border }]}>
              <Text style={[styles.btnGhostTxt, { color: c.text }]}>{t('calls.searchClear')}</Text>
            </Pressable>
          ) : null}
          <Pressable
            onPress={apply}
            disabled={!day}
            style={[styles.btn, { backgroundColor: c.primary, opacity: day ? 1 : 0.5 }]}
          >
            <Icon name="magnify" size={18} color="#fff" />
            <Text style={styles.btnTxt}>{t('common.search')}</Text>
          </Pressable>
        </View>
      </View>

      {openPicker ? (
        <DateTimePicker
          value={
            openPicker === 'date'
              ? day ?? new Date()
              : (() => {
                  const base = new Date();
                  const mins = openPicker === 'from' ? fromMin : toMin;
                  base.setHours(mins !== null ? Math.floor(mins / 60) : base.getHours());
                  base.setMinutes(mins !== null ? mins % 60 : base.getMinutes());
                  return base;
                })()
          }
          mode={openPicker === 'date' ? 'date' : 'time'}
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          is24Hour
          onChange={onPickerChange}
        />
      ) : null}
      {/* iOS : le picker reste ouvert (spinner inline) tant qu'on ne ferme
          pas nous-mêmes — un bouton "Terminé" au-dessus du clavier système
          n'existe pas pour ce mode, donc on ajoute le nôtre. */}
      {Platform.OS === 'ios' && openPicker ? (
        <Pressable
          onPress={() => setOpenPicker(null)}
          style={[styles.iosDoneBtn, { backgroundColor: c.primary }]}
        >
          <Text style={styles.btnTxt}>{t('common.done')}</Text>
        </Pressable>
      ) : null}
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ffffff33',
    marginBottom: 14,
  },
  title: { fontSize: 17, fontWeight: '800', marginBottom: 14 },
  shortcuts: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, borderWidth: 1.5 },
  chipTxt: { fontSize: 13, fontWeight: '700' },
  label: { fontSize: 12, fontWeight: '700', marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 14,
  },
  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  timeField: { flex: 1 },
  input: { flex: 1, fontSize: 15 },
  error: { fontSize: 13, fontWeight: '600', marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 10, marginTop: 6 },
  btn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 13,
    borderRadius: 24,
  },
  btnTxt: { color: '#fff', fontWeight: '800', fontSize: 14 },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1.5 },
  btnGhostTxt: { fontWeight: '800', fontSize: 14 },
  iosDoneBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    marginTop: 8,
    marginHorizontal: 20,
    borderRadius: 24,
  },
});
