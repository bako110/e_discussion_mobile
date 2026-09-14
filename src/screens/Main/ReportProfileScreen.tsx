/**
 * Signaler un profil (façon WhatsApp « Signaler ») : motif + détails libres
 * envoyés à la modération. N'affecte pas la relation (contrairement au
 * blocage) — l'utilisateur signalé n'en est pas informé.
 */
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Button, Icon, Screen, TextField, showToast } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { userService, type ReportReason } from '@/services';

const REASONS: ReportReason[] = [
  'spam',
  'harassment',
  'fake_profile',
  'inappropriate_content',
  'scam',
  'other',
];

export const ReportProfileScreen: React.FC<MainScreenProps<'ReportProfile'>> = ({
  route,
  navigation,
}) => {
  const { userId, name } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState('');
  const [sending, setSending] = useState(false);

  const submit = async () => {
    if (!reason || sending) return;
    setSending(true);
    try {
      await userService.report(userId, reason, details);
      showToast(t('report.sent'));
      navigation.goBack();
    } catch {
      showToast(t('errors.generic'), { type: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        title={t('report.title')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.hdrBtn}>
            <Icon name="arrow-left" size={24} color={c.onHeader} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Text style={[styles.intro, { color: c.textMuted }]}>
            {t('report.intro', { name })}
          </Text>

          <Text style={[styles.sectionTitle, { color: c.textMuted }]}>{t('report.reason')}</Text>
          <View style={[styles.card, { backgroundColor: c.card, borderColor: c.border }]}>
            {REASONS.map((r, i) => {
              const selected = reason === r;
              return (
                <Pressable
                  key={r}
                  onPress={() => setReason(r)}
                  android_ripple={{ color: c.surfaceAlt }}
                  style={[
                    styles.row,
                    i < REASONS.length - 1 && {
                      borderBottomColor: c.divider,
                      borderBottomWidth: StyleSheet.hairlineWidth,
                    },
                  ]}
                >
                  <Text style={[styles.rowLabel, { color: c.text }]}>
                    {t(`report.reason_${r}`)}
                  </Text>
                  <Icon
                    name={selected ? 'radiobox-marked' : 'radiobox-blank'}
                    size={22}
                    color={selected ? c.primary : c.textFaint}
                  />
                </Pressable>
              );
            })}
          </View>

          <Text style={[styles.sectionTitle, { color: c.textMuted, marginTop: 20 }]}>
            {t('report.detailsLabel')}
          </Text>
          <TextField
            placeholder={t('report.detailsPlaceholder')}
            value={details}
            onChangeText={setDetails}
            multiline
            numberOfLines={4}
            maxLength={1000}
            style={styles.details}
          />

          <Button
            label={t('report.submit')}
            onPress={() => void submit()}
            disabled={!reason}
            loading={sending}
            style={styles.submitBtn}
          />
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  hdrBtn: { padding: 4 },
  scroll: { padding: 16, paddingBottom: 40 },
  intro: { fontSize: 13.5, lineHeight: 19, marginBottom: 18 },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
    marginLeft: 4,
  },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 14,
  },
  rowLabel: { fontSize: 15, fontWeight: '500' },
  details: { height: 110, textAlignVertical: 'top', paddingTop: 12 },
  submitBtn: { marginTop: 8 },
});
