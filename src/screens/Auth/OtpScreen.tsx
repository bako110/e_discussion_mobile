import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api';
import { Button, Icon, Screen } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import type { AuthScreenProps } from '@/navigation/types';
import { authService } from '@/services';

const CELLS = 6;

export const OtpScreen: React.FC<AuthScreenProps<'Otp'>> = ({ route, navigation }) => {
  const { e164, pretty, resendIn, devCode: initialDevCode } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { setSession } = useAuth();
  const c = theme.colors;
  const inputRef = useRef<TextInput>(null);

  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [seconds, setSeconds] = useState(resendIn);
  // MODE TEST : code renvoyé par le serveur (OTP_DEV_ECHO). Absent en prod.
  const [devCode, setDevCode] = useState<string | null>(initialDevCode ?? null);

  useEffect(() => {
    if (seconds <= 0) return;
    const id = setInterval(() => setSeconds((s) => (s > 0 ? s - 1 : 0)), 1000);
    return () => clearInterval(id);
  }, [seconds]);

  const submit = async (value: string) => {
    setError(null);
    setLoading(true);
    try {
      const res = await authService.phoneVerify(e164, value);
      setSession(res.user); // AuthContext route vers onboarding ou l'app
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('auth.invalidCode'));
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const onChange = (text: string) => {
    const digits = text.replace(/\D/g, '').slice(0, CELLS);
    setCode(digits);
    setError(null);
    if (digits.length === CELLS) void submit(digits);
  };

  const resend = async () => {
    if (seconds > 0) return;
    setError(null);
    try {
      const res = await authService.phoneStart(e164);
      setSeconds(res.resend_in);
      setDevCode(res.dev_code ?? null);
      setCode('');
    } catch {
      setSeconds(30);
    }
  };

  /** MODE TEST : remplit le champ avec le code du serveur et valide direct. */
  const useDevCode = () => {
    if (!devCode) return;
    setCode(devCode);
    void submit(devCode);
  };

  return (
    <Screen padded>
      <Pressable style={styles.back} onPress={() => navigation.goBack()} hitSlop={10}>
        <Icon name="chevron-left" size={26} color={c.primary} />
        <Text style={{ color: c.primary, fontSize: 15, fontWeight: '600' }}>
          {t('auth.wrongNumber')}
        </Text>
      </Pressable>

      <View style={styles.head}>
        <Text style={[styles.title, { color: c.text }]}>{t('auth.otpTitle')}</Text>
        <Text style={[styles.subtitle, { color: c.textMuted }]}>
          {t('auth.otpSubtitle')}{'\n'}
          <Text style={{ color: c.text, fontWeight: '700' }}>{pretty}</Text>
        </Text>
      </View>

      <Pressable style={styles.cells} onPress={() => inputRef.current?.focus()}>
        {Array.from({ length: CELLS }).map((_, i) => (
          <View
            key={i}
            style={[
              styles.cell,
              {
                borderColor:
                  error ? c.danger : code.length === i ? c.primary : c.border,
                backgroundColor: c.surface,
              },
            ]}
          >
            <Text style={[styles.cellText, { color: c.text }]}>{code[i] ?? ''}</Text>
          </View>
        ))}
      </Pressable>

      <TextInput
        ref={inputRef}
        value={code}
        onChangeText={onChange}
        keyboardType="number-pad"
        maxLength={CELLS}
        autoFocus
        caretHidden
        style={styles.hidden}
      />

      {error ? <Text style={[styles.error, { color: c.danger }]}>{error}</Text> : null}

      {devCode ? (
        <Pressable
          onPress={useDevCode}
          style={[styles.devBox, { backgroundColor: c.primary + '14', borderColor: c.primary + '55' }]}
        >
          <Icon name="flask-outline" size={16} color={c.primary} />
          <Text style={[styles.devLabel, { color: c.textMuted }]}>
            Mode test — code :
          </Text>
          <Text style={[styles.devCode, { color: c.primary }]}>{devCode}</Text>
          <View style={[styles.devBtn, { backgroundColor: c.primary }]}>
            <Text style={styles.devBtnTxt}>Valider</Text>
          </View>
        </Pressable>
      ) : null}

      <Button
        label={t('auth.verify')}
        onPress={() => submit(code)}
        loading={loading}
        disabled={code.length !== CELLS}
        style={{ marginTop: 22 }}
      />

      <Pressable onPress={resend} style={styles.resend} disabled={seconds > 0}>
        <Text style={{ color: seconds > 0 ? c.textFaint : c.primary, fontWeight: '600' }}>
          {seconds > 0 ? t('auth.resendIn', { s: seconds }) : t('auth.resendCode')}
        </Text>
      </Pressable>
    </Screen>
  );
};

const styles = StyleSheet.create({
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 10 },
  head: { marginTop: 20, marginBottom: 28 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, marginTop: 8, lineHeight: 21 },
  cells: { flexDirection: 'row', justifyContent: 'space-between' },
  cell: {
    width: 48,
    height: 58,
    borderWidth: 1.5,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellText: { fontSize: 24, fontWeight: '800' },
  hidden: { position: 'absolute', opacity: 0, height: 1, width: 1 },
  error: { marginTop: 14, textAlign: 'center' },
  resend: { alignItems: 'center', marginTop: 18 },
  devBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
  },
  devLabel: { fontSize: 12.5, fontWeight: '600' },
  devCode: { fontSize: 18, fontWeight: '800', letterSpacing: 3, flex: 1 },
  devBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  devBtnTxt: { color: '#fff', fontSize: 13, fontWeight: '700' },
});
