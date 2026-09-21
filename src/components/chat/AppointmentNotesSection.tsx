/**
 * Section « Notes » d'un rendez-vous — chaque participant (et l'organisateur)
 * peut ajouter des notes, avec un choix de visibilité par note :
 *  - privée  : visible seulement par son auteur ;
 *  - publique : visible par tous les participants du RDV.
 * Seul l'auteur d'une note peut la supprimer (appui long).
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Avatar, Icon, confirmAlert, showToast } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { appointmentService } from '@/services';
import type { AppointmentNote, AppointmentNoteVisibility } from '@/types';
import { clockTime } from '@/utils/time';

interface Props {
  appointmentId: string;
}

export const AppointmentNotesSection: React.FC<Props> = ({ appointmentId }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me } = useAuth();
  const c = theme.colors;

  const [notes, setNotes] = useState<AppointmentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [visibility, setVisibility] = useState<AppointmentNoteVisibility>('private');
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    try {
      setNotes(await appointmentService.listNotes(appointmentId));
    } catch {
      /* best-effort — la section reste vide plutôt que bloquer l'écran */
    } finally {
      setLoading(false);
    }
  }, [appointmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  const submit = async () => {
    const body = text.trim();
    if (!body || submitting) return;
    setSubmitting(true);
    try {
      const note = await appointmentService.createNote(appointmentId, body, visibility);
      setNotes((prev) => [note, ...prev]);
      setText('');
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setSubmitting(false);
    }
  };

  const onLongPressNote = (note: AppointmentNote) => {
    if (note.author.id !== me?.id) return; // seul l'auteur peut supprimer sa note
    confirmAlert(
      t('appointments.deleteNoteTitle'),
      t('appointments.deleteNoteBody'),
      () => {
        void appointmentService
          .deleteNote(appointmentId, note.id)
          .then(() => setNotes((prev) => prev.filter((n) => n.id !== note.id)))
          .catch(() => showToast(t('errors.generic'), { type: 'error' }));
      },
      { confirmText: t('common.delete'), destructive: true },
    );
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.sectionLabel, { color: c.textMuted }]}>{t('appointments.notesSection')}</Text>

      <View style={[styles.composer, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={t('appointments.noteFieldPlaceholder')}
          placeholderTextColor={c.textFaint}
          multiline
          style={[styles.input, { color: c.text }]}
        />
        <View style={styles.composerRow}>
          <View style={styles.visToggle}>
            <Pressable
              onPress={() => setVisibility('private')}
              style={[
                styles.visBtn,
                visibility === 'private' && { backgroundColor: c.primary },
              ]}
            >
              <Icon name="lock-outline" size={12} color={visibility === 'private' ? '#fff' : c.textMuted} />
              <Text style={[styles.visTxt, { color: visibility === 'private' ? '#fff' : c.textMuted }]}>
                {t('appointments.noteVisibilityPrivate')}
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setVisibility('public')}
              style={[
                styles.visBtn,
                visibility === 'public' && { backgroundColor: c.primary },
              ]}
            >
              <Icon name="earth" size={12} color={visibility === 'public' ? '#fff' : c.textMuted} />
              <Text style={[styles.visTxt, { color: visibility === 'public' ? '#fff' : c.textMuted }]}>
                {t('appointments.noteVisibilityPublic')}
              </Text>
            </Pressable>
          </View>
          <Pressable
            onPress={submit}
            disabled={!text.trim() || submitting}
            style={[styles.sendBtn, { backgroundColor: c.primary, opacity: text.trim() ? 1 : 0.5 }]}
          >
            {submitting ? <ActivityIndicator size="small" color="#fff" /> : <Icon name="send" size={15} color="#fff" />}
          </Pressable>
        </View>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loader} color={c.primary} />
      ) : notes.length === 0 ? (
        <Text style={[styles.emptyTxt, { color: c.textFaint }]}>{t('appointments.noNotes')}</Text>
      ) : (
        notes.map((note) => {
          const mine = note.author.id === me?.id;
          return (
            <Pressable
              key={note.id}
              onLongPress={() => onLongPressNote(note)}
              style={[styles.noteCard, { backgroundColor: c.surfaceAlt, borderColor: c.border }]}
            >
              <View style={styles.noteHead}>
                <Avatar uri={note.author.avatar_url} name={note.author.display_name} size={22} />
                <Text style={[styles.noteAuthor, { color: c.text }]} numberOfLines={1}>
                  {mine ? t('common.you') : note.author.display_name || note.author.username}
                </Text>
                <Icon
                  name={note.visibility === 'private' ? 'lock-outline' : 'earth'}
                  size={12}
                  color={c.textFaint}
                />
                <Text style={[styles.noteTime, { color: c.textFaint }]}>{clockTime(note.created_at)}</Text>
              </View>
              <Text style={[styles.noteBody, { color: c.text }]}>{note.body}</Text>
            </Pressable>
          );
        })
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: { marginTop: 18 },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  composer: { borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 12 },
  input: { fontSize: 14, minHeight: 40, maxHeight: 100, textAlignVertical: 'top' },
  composerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 6 },
  visToggle: { flexDirection: 'row', gap: 6 },
  visBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 5, borderRadius: 10 },
  visTxt: { fontSize: 11, fontWeight: '700' },
  sendBtn: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  loader: { marginVertical: 12 },
  emptyTxt: { fontSize: 13, textAlign: 'center', marginVertical: 12 },
  noteCard: { borderRadius: 12, borderWidth: 1, padding: 10, marginBottom: 8 },
  noteHead: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  noteAuthor: { flex: 1, fontSize: 13, fontWeight: '700' },
  noteTime: { fontSize: 11 },
  noteBody: { fontSize: 14, lineHeight: 19 },
});
