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
import { AppHeader, Avatar, Button, Icon, Screen, TextField, showSheet, showToast } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useMediaPicker } from '@/hooks/useMediaPicker';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { userService } from '@/services';

export const EditProfileScreen: React.FC<MainScreenProps<'EditProfile'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const { me, refreshMe } = useAuth();
  const { online } = useSync();
  const picker = useMediaPicker();
  const c = theme.colors;

  const [displayName, setDisplayName] = useState(me?.display_name ?? '');
  const [username, setUsername] = useState(me?.username ?? '');
  const [about, setAbout] = useState(me?.about ?? '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(me?.avatar_url ?? null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const changeAvatar = () => {
    showSheet({
      title: t('settings.changePhoto'),
      actions: [
        { label: t('stories.fromGallery'), icon: 'image-outline', onPress: () => void pickAvatar(false) },
        { label: t('stories.fromCamera'), icon: 'camera-outline', onPress: () => void pickAvatar(true) },
      ],
    });
  };

  const pickAvatar = async (camera: boolean) => {
    // recadrage circulaire local AVANT upload (façon WhatsApp)
    const up = await picker.pickAvatar({ camera });
    if (!up) return;
    setAvatarUrl(up.url);
    // enregistrement immédiat de l'avatar
    try {
      await userService.updateMe({ avatar_url: up.url });
      await refreshMe();
      showToast(t('settings.photoUpdated'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('errors.generic'));
    }
  };

  const save = async () => {
    setError(null);
    setSaving(true);
    try {
      const patch: Parameters<typeof userService.updateMe>[0] = {
        display_name: displayName.trim() || undefined,
        about: about.trim() || undefined,
        avatar_url: avatarUrl ?? undefined,
      };
      // le username n'est envoyé QUE s'il a changé (validation serveur -> en ligne)
      if (username.trim() && username.trim() !== me?.username) {
        patch.username = username.trim();
      }
      await userService.updateMe(patch);
      await refreshMe();
      setSaved(true);
      showToast(t('settings.profileUpdated'));
      setTimeout(() => navigation.goBack(), 400);
    } catch (e) {
      const offline = e instanceof ApiError && e.status === 0;
      setError(offline ? t('sync.onlineRequiredBody') : e instanceof ApiError ? e.message : t('errors.generic'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('settings.editProfile')}
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
          <View style={styles.avatarWrap}>
            <Pressable onPress={changeAvatar} disabled={picker.busy}>
              <Avatar uri={avatarUrl} name={displayName || me?.username} size={92} />
              <View style={[styles.avatarBadge, { backgroundColor: c.primary, borderColor: c.background }]}>
                {picker.busy ? (
                  <ActivityIndicator color="#fff" size="small" />
                ) : (
                  <Icon name="camera" size={15} color="#fff" />
                )}
              </View>
            </Pressable>
          </View>

          <TextField
            label={t('settings.displayName')}
            value={displayName}
            onChangeText={setDisplayName}
            maxLength={80}
          />
          <TextField
            label={t('settings.username')}
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={32}
          />
          <TextField
            label={t('settings.about')}
            value={about}
            onChangeText={setAbout}
            multiline
            maxLength={500}
            style={{ height: 88, textAlignVertical: 'top', paddingTop: 12 }}
            error={error}
          />

          {!online ? (
            <Text style={[styles.offlineNote, { color: c.textFaint }]}>{t('sync.offline')}</Text>
          ) : null}

          <Button
            label={saved ? t('settings.saved') : t('common.save')}
            onPress={save}
            loading={saving}
            disabled={!online}
            style={{ marginTop: 12 }}
          />
        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  body: { padding: 20 },
  avatarWrap: { alignItems: 'center', marginBottom: 24 },
  avatarBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 3,
    alignItems: 'center',
    justifyContent: 'center',
  },
  offlineNote: { fontSize: 12, textAlign: 'center', marginTop: 4 },
});
