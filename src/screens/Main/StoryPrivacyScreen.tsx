/**
 * Confidentialité des statuts — façon WhatsApp, 3 modes :
 *   - Mes contacts
 *   - Mes contacts sauf…  (exclusion : liste de personnes qui NE voient PAS)
 *   - Uniquement…         (inclusion : SEULES ces personnes voient)
 *
 * Local-first : le choix est appliqué tout de suite (cache), l'appel serveur
 * est rejoué par l'outbox à la reconnexion.
 */
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainNav } from '@/navigation/types';
import { storyService } from '@/services';
import type { StoryAudience, StoryAudienceMode } from '@/services/storyService';
import { selectContacts } from '@/screens/Main/SelectContactsScreen';

const MODES: StoryAudienceMode[] = ['contacts', 'contacts_except', 'only'];

export const StoryPrivacyScreen: React.FC = () => {
  const navigation = useNavigation<MainNav>();
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [audience, setAudience] = useState<StoryAudience>(() => storyService.readAudienceCache());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    storyService
      .audience()
      .then((a) => alive && setAudience(a))
      .catch(() => undefined)
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, []);

  const persist = async (next: StoryAudience) => {
    setAudience(next);
    setSaving(true);
    try {
      await storyService.setAudience(next);
    } catch {
      showAlert(t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  const onPickMode = async (mode: StoryAudienceMode) => {
    if (mode === audience.mode && mode === 'contacts') return;
    if (mode === 'contacts') {
      await persist({ mode: 'contacts', contact_ids: [] });
      return;
    }
    // contacts_except / only -> on ouvre la sélection de contacts
    const ids = await selectContacts({
      title:
        mode === 'contacts_except'
          ? t('storyPrivacy.exceptTitle')
          : t('storyPrivacy.onlyTitle'),
      preselected: audience.mode === mode ? audience.contact_ids : [],
    });
    if (ids == null) return; // annulé -> on ne change rien
    await persist({ mode, contact_ids: ids });
  };

  const editList = async () => {
    if (audience.mode === 'contacts') return;
    const ids = await selectContacts({
      title:
        audience.mode === 'contacts_except'
          ? t('storyPrivacy.exceptTitle')
          : t('storyPrivacy.onlyTitle'),
      preselected: audience.contact_ids,
    });
    if (ids == null) return;
    await persist({ mode: audience.mode, contact_ids: ids });
  };

  const modeLabel = (m: StoryAudienceMode) => t(`storyPrivacy.mode_${m}`);
  const modeHint = (m: StoryAudienceMode) => t(`storyPrivacy.hint_${m}`);

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('storyPrivacy.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={[styles.section, { color: c.textMuted }]}>
          {t('storyPrivacy.whoCanSee')}
        </Text>

        <View style={[styles.card, { backgroundColor: c.card }]}>
          {MODES.map((m, i) => {
            const on = audience.mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => onPickMode(m)}
                disabled={saving}
                style={[
                  styles.row,
                  i < MODES.length - 1 && { borderBottomColor: c.divider, borderBottomWidth: StyleSheet.hairlineWidth },
                ]}
              >
                <View
                  style={[
                    styles.radio,
                    { borderColor: on ? c.primary : c.border },
                  ]}
                >
                  {on ? <View style={[styles.dot, { backgroundColor: c.primary }]} /> : null}
                </View>
                <View style={styles.rowText}>
                  <Text style={[styles.rowLabel, { color: c.text }]}>{modeLabel(m)}</Text>
                  <Text style={[styles.rowHint, { color: c.textMuted }]}>{modeHint(m)}</Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        {audience.mode !== 'contacts' ? (
          <Pressable
            onPress={editList}
            disabled={saving}
            style={[styles.listRow, { backgroundColor: c.card }]}
          >
            <Icon name="account-multiple-outline" size={20} color={c.primary} />
            <Text style={[styles.listLabel, { color: c.text }]}>
              {audience.mode === 'contacts_except'
                ? t('storyPrivacy.excludedN', { count: audience.contact_ids.length })
                : t('storyPrivacy.allowedN', { count: audience.contact_ids.length })}
            </Text>
            <Icon name="chevron-right" size={22} color={c.textMuted} />
          </Pressable>
        ) : null}

        {loading || saving ? (
          <ActivityIndicator style={{ marginTop: 18 }} color={c.primary} />
        ) : null}

        <Text style={[styles.footer, { color: c.textFaint }]}>
          {t('storyPrivacy.footer')}
        </Text>
      </ScrollView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { paddingHorizontal: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 12, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 8, marginLeft: 4 },
  card: { borderRadius: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dot: { width: 10, height: 10, borderRadius: 5 },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 15.5, fontWeight: '600' },
  rowHint: { fontSize: 12.5, marginTop: 2 },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    borderRadius: 14,
    marginTop: 14,
  },
  listLabel: { flex: 1, fontSize: 15, fontWeight: '500' },
  footer: { fontSize: 12, lineHeight: 17, marginTop: 20, marginHorizontal: 4 },
});
