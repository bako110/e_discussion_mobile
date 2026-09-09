import React, { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api';
import { AppHeader, Button, Icon, Screen, TextField } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { authService } from '@/services';

/**
 * Lier un identifiant secondaire (e-mail ou numéro) au compte courant.
 * Étape 1 : saisir l'identifiant → OTP envoyé. Étape 2 : saisir le code.
 */
export const LinkIdentifierScreen: React.FC<MainScreenProps<'LinkIdentifier'>> = ({
  route,
  navigation,
}) => {
  const kind = route.params.kind; // 'email' | 'phone'
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { refreshMe } = useAuth();
  const c = theme.colors;

  const [step, setStep] = useState<'input' | 'code'>('input');
  const [value, setValue] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isEmail = kind === 'email';
  const title = isEmail ? t('settings.linkEmail') : t('settings.linkPhone');

  const sendOtp = async () => {
    const v = value.trim();
    if (!v || busy) return;
    setBusy(true);
    setError(null);
    try {
      await authService.requestLinkOtp(v, kind);
      setStep('code');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    const cd = code.trim();
    if (cd.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (isEmail) await authService.linkEmail(value.trim(), cd);
      else await authService.linkPhone(value.trim(), cd);
      await refreshMe();
      navigation.goBack();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={title}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="chevron-left" size={28} color={c.primary} />
          </Pressable>
        }
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.body}>
          {step === 'input' ? (
            <>
              <Text style={[styles.hint, { color: c.textMuted }]}>
                {isEmail ? t('settings.linkEmailHint') : t('settings.linkPhoneHint')}
              </Text>
              <TextField
                label={isEmail ? t('settings.email') : t('settings.phone')}
                value={value}
                onChangeText={setValue}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType={isEmail ? 'email-address' : 'phone-pad'}
                placeholder={isEmail ? 'nom@exemple.com' : '+226 70 00 00 00'}
                error={error}
              />
              <Button
                label={t('settings.sendCode')}
                onPress={sendOtp}
                loading={busy}
                disabled={!value.trim()}
                style={{ marginTop: 12 }}
              />
            </>
          ) : (
            <>
              <Text style={[styles.hint, { color: c.textMuted }]}>
                {t('settings.codeSentTo', { target: value.trim() })}
              </Text>
              <TextField
                label={t('settings.verificationCode')}
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
                maxLength={8}
                placeholder="123456"
                error={error}
              />
              <Button
                label={t('common.continue')}
                onPress={confirm}
                loading={busy}
                disabled={code.trim().length < 4}
                style={{ marginTop: 12 }}
              />
              <Pressable onPress={sendOtp} disabled={busy} style={styles.resend}>
                {busy ? (
                  <ActivityIndicator size="small" color={c.primary} />
                ) : (
                  <Text style={[styles.resendText, { color: c.primary }]}>
                    {t('settings.resendCode')}
                  </Text>
                )}
              </Pressable>
            </>
          )}
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 20 },
  hint: { fontSize: 13, lineHeight: 19, marginBottom: 16 },
  resend: { alignSelf: 'center', marginTop: 16, padding: 8 },
  resendText: { fontSize: 14, fontWeight: '700' },
});
