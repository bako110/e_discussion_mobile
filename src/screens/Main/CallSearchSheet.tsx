/**
 * Bottom sheet de recherche d'appels par date précise + plage horaire
 * optionnelle. Pas de date-picker natif dans le projet (nécessiterait un
 * rebuild natif) — sélecteur maison : raccourcis courants + saisie
 * manuelle JJ/MM/AAAA et HH:MM.
 */
import React, { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
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

/** Parse "JJ/MM/AAAA" -> Date locale valide, ou null si invalide. */
function parseDateInput(s: string): Date | null {
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const d = new Date(year, month - 1, day);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/** Parse "HH:MM" -> minutes depuis minuit, ou null si invalide/vide. */
function parseTimeInput(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
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

  const [dateInput, setDateInput] = useState('');
  const [fromInput, setFromInput] = useState('');
  const [toInput, setToInput] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shortcut = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    setDateInput(
      `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`,
    );
    setError(null);
  };

  const apply = () => {
    const day = parseDateInput(dateInput);
    if (!day) {
      setError(t('calls.searchInvalidDate'));
      return;
    }
    const fromMin = parseTimeInput(fromInput);
    const toMin = parseTimeInput(toInput);
    if ((fromInput.trim() && fromMin === null) || (toInput.trim() && toMin === null)) {
      setError(t('calls.searchInvalidTime'));
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
    setDateInput('');
    setFromInput('');
    setToInput('');
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
        <View style={[styles.field, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
          <Icon name="calendar-outline" size={18} color={c.textFaint} />
          <TextInput
            value={dateInput}
            onChangeText={setDateInput}
            placeholder="JJ/MM/AAAA"
            placeholderTextColor={c.textFaint}
            keyboardType="number-pad"
            maxLength={10}
            style={[styles.input, { color: c.text }]}
          />
        </View>

        <Text style={[styles.label, { color: c.textMuted }]}>{t('calls.searchTimeRange')}</Text>
        <View style={styles.timeRow}>
          <View style={[styles.field, styles.timeField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
            <Icon name="clock-outline" size={18} color={c.textFaint} />
            <TextInput
              value={fromInput}
              onChangeText={setFromInput}
              placeholder="HH:MM"
              placeholderTextColor={c.textFaint}
              keyboardType="number-pad"
              maxLength={5}
              style={[styles.input, { color: c.text }]}
            />
          </View>
          <Text style={{ color: c.textMuted }}>—</Text>
          <View style={[styles.field, styles.timeField, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
            <Icon name="clock-outline" size={18} color={c.textFaint} />
            <TextInput
              value={toInput}
              onChangeText={setToInput}
              placeholder="HH:MM"
              placeholderTextColor={c.textFaint}
              keyboardType="number-pad"
              maxLength={5}
              style={[styles.input, { color: c.text }]}
            />
          </View>
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
            disabled={!dateInput.trim()}
            style={[styles.btn, { backgroundColor: c.primary, opacity: dateInput.trim() ? 1 : 0.5 }]}
          >
            <Icon name="magnify" size={18} color="#fff" />
            <Text style={styles.btnTxt}>{t('common.search')}</Text>
          </Pressable>
        </View>
      </View>
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
});
