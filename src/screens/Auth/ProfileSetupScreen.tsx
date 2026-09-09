import React, { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { ApiError } from '@/api';
import { Avatar, Button, Screen, TextField } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useTheme } from '@/context/ThemeContext';
import { authService } from '@/services';

const USERNAME_RE = /^[a-zA-Z0-9_.]{3,32}$/;

export const ProfileSetupScreen: React.FC = () => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me, completeOnboarding } = useAuth();
  const c = theme.colors;

  const [fullName, setFullName] = useState(me?.display_name ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const usernameOk = USERNAME_RE.test(username.trim());
  const nameOk = fullName.trim().length >= 2;
  const canSubmit = useMemo(() => nameOk && usernameOk, [nameOk, usernameOk]);

  const submit = async () => {
    setError(null);
    setSaving(true);
    try {
      const updated = await authService.updateProfile({
        display_name: fullName.trim(),
        username: username.trim(),
      });
      completeOnboarding(updated);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'username_taken') {
        setError(t('auth.usernameTaken'));
      } else {
        setError(err instanceof ApiError ? err.message : t('errors.generic'));
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen padded>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.head}>
          <Avatar name={fullName || me?.phone} size={84} />
          <Text style={[styles.title, { color: c.text }]}>{t('auth.profileTitle')}</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>{t('auth.profileSubtitle')}</Text>
        </View>

        <TextField
          label={t('auth.fullName')}
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
          maxLength={80}
        />
        <TextField
          label={t('auth.username')}
          value={username}
          onChangeText={(v) => setUsername(v.replace(/\s/g, ''))}
          autoCapitalize="none"
          autoCorrect={false}
          maxLength={32}
          error={error}
        />
        <Text style={[styles.hint, { color: c.textFaint }]}>{t('auth.usernameHint')}</Text>

        <View style={styles.flex} />

        <Button
          label={t('auth.finish')}
          onPress={submit}
          loading={saving}
          disabled={!canSubmit}
        />
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { alignItems: 'center', gap: 10, marginTop: 24, marginBottom: 24 },
  title: { fontSize: 24, fontWeight: '800', letterSpacing: -0.4 },
  subtitle: { fontSize: 14, textAlign: 'center', paddingHorizontal: 20 },
  hint: { fontSize: 12, marginTop: -6, marginLeft: 2 },
});
