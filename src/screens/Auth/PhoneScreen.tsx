import React, { useMemo, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api';
import {
  BrandLogo,
  Button,
  CountryPickerModal,
  Icon,
  Screen,
} from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { AuthScreenProps } from '@/navigation/types';
import { authService } from '@/services';
import {
  COUNTRIES,
  DEFAULT_COUNTRY,
  type Country,
  formatPretty,
  toE164,
} from '@/utils/countries';

export const PhoneScreen: React.FC<AuthScreenProps<'Phone'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const c = theme.colors;

  const [country, setCountry] = useState<Country>(DEFAULT_COUNTRY ?? COUNTRIES[0]!);
  const [local, setLocal] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const digits = local.replace(/\D/g, '');
  const valid = digits.replace(/^0+/, '').length >= 6;
  const e164 = useMemo(() => toE164(country, local), [country, local]);
  const pretty = useMemo(() => formatPretty(country, local), [country, local]);

  const startVerification = async () => {
    setConfirmOpen(false);
    setError(null);
    setSending(true);
    try {
      const res = await authService.phoneStart(e164);
      navigation.navigate('Otp', {
        e164: res.phone,
        pretty,
        resendIn: res.resend_in,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.invalidPhone'));
    } finally {
      setSending(false);
    }
  };

  return (
    <Screen padded>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.head}>
          <BrandLogo size={64} variant="mark" />
          <Text style={[styles.title, { color: c.text }]}>{t('auth.phoneTitle')}</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>{t('auth.phoneSubtitle')}</Text>
        </View>

        <View style={styles.form}>
          <Text style={[styles.label, { color: c.textMuted }]}>{t('auth.phone')}</Text>
          <View style={styles.inputRow}>
            <Pressable
              style={[styles.countryBtn, { backgroundColor: c.surface, borderColor: c.border }]}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={styles.flag}>{country.flag}</Text>
              <Text style={[styles.dial, { color: c.text }]}>+{country.dial}</Text>
              <Icon name="chevron-down" size={16} color={c.textFaint} />
            </Pressable>

            <TextInput
              value={local}
              onChangeText={(v) => {
                setLocal(v);
                setError(null);
              }}
              keyboardType="phone-pad"
              placeholder={t('auth.phonePlaceholder')}
              placeholderTextColor={c.textFaint}
              autoFocus
              style={[
                styles.phoneInput,
                {
                  color: c.text,
                  backgroundColor: c.surface,
                  borderColor: error ? c.danger : c.border,
                },
              ]}
            />
          </View>
          {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}
        </View>

        <View style={styles.flex} />

        <Button
          label={t('auth.next')}
          onPress={() => setConfirmOpen(true)}
          disabled={!valid}
          loading={sending}
        />
      </KeyboardAvoidingView>

      <CountryPickerModal
        visible={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onSelect={setCountry}
        selectedIso={country.iso}
      />

      {/* Modal de confirmation du numero */}
      <Modal visible={confirmOpen} transparent animationType="fade" onRequestClose={() => setConfirmOpen(false)}>
        <View style={[styles.backdrop, { backgroundColor: c.overlay }]}>
          <View style={[styles.sheet, { backgroundColor: c.card }]}>
            <Text style={[styles.sheetTitle, { color: c.text }]}>{t('auth.confirmTitle')}</Text>
            <Text style={[styles.sheetBody, { color: c.textMuted }]}>{t('auth.confirmBody')}</Text>
            <Text style={[styles.sheetNumber, { color: c.text }]}>
              {country.flag}  {pretty}
            </Text>
            <View style={styles.sheetActions}>
              <Button
                label={t('auth.confirmEdit')}
                variant="secondary"
                onPress={() => setConfirmOpen(false)}
                style={styles.flex}
              />
              <View style={{ width: 10 }} />
              <Button label={t('auth.confirmOk')} onPress={startVerification} style={styles.flex} />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { alignItems: 'center', gap: 10, marginTop: 32, marginBottom: 28 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, textAlign: 'center', paddingHorizontal: 24, lineHeight: 20 },
  form: { gap: 6 },
  label: { fontSize: 13, fontWeight: '600', marginLeft: 2 },
  inputRow: { flexDirection: 'row', gap: 8 },
  countryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 52,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1.5,
  },
  flag: { fontSize: 20 },
  dial: { fontSize: 15, fontWeight: '600' },
  phoneInput: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: '600',
    letterSpacing: 1,
  },
  error: { fontSize: 12, marginLeft: 2, marginTop: 4 },
  backdrop: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sheet: { width: '100%', borderRadius: 20, padding: 22 },
  sheetTitle: { fontSize: 18, fontWeight: '800' },
  sheetBody: { fontSize: 14, marginTop: 8 },
  sheetNumber: { fontSize: 20, fontWeight: '800', marginTop: 12, marginBottom: 20, textAlign: 'center' },
  sheetActions: { flexDirection: 'row' },
});
