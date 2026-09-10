/**
 * Aperçu d'un média AVANT envoi dans une conversation (façon WhatsApp) :
 *  - recadrer / faire pivoter (éditeur natif),
 *  - ajouter une légende,
 *  - « Envoyer » -> `pendingMediaService.sendMedia` (aucun upload avant ce tap).
 *
 * `route.params.local` = fichier local non uploadé. Le message optimiste
 * (⏱) part avec l'URI locale ; l'upload est différé par l'outbox.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import ImagePicker from 'react-native-image-crop-picker';

import { Icon, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { pendingMediaService } from '@/services';
import { syncNow } from '@/sync/syncEngine';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';

export const ChatMediaPreviewScreen: React.FC<MainScreenProps<'ChatMediaPreview'>> = ({
  route,
  navigation,
}) => {
  const { conversationId, partnerId, senderId, local: initialLocal } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [local, setLocal] = useState<LocalMediaFile>(initialLocal);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [cropping, setCropping] = useState(false);

  const uri = local.file.uri.startsWith('file://') ? local.file.uri : `file://${local.file.uri}`;
  const isImage = local.kind === 'image';
  const isVideo = local.kind === 'video';

  const crop = async () => {
    if (!isImage || cropping) return;
    setCropping(true);
    try {
      const res = await ImagePicker.openCropper({
        path: uri,
        mediaType: 'photo',
        freeStyleCropEnabled: true,
        cropperToolbarTitle: t('stories.cropTitle'),
        cropperActiveWidgetColor: '#1E6FE0',
        cropperToolbarColor: '#000000',
        cropperToolbarWidgetColor: '#FFFFFF',
        enableRotationGesture: true,
        compressImageQuality: 0.9,
      });
      const path = (res as { path?: string; width?: number; height?: number }).path;
      if (path) {
        setLocal((cur) => ({
          ...cur,
          file: {
            ...cur.file,
            uri: path.startsWith('file://') ? path : `file://${path}`,
          },
          width: (res as { width?: number }).width ?? cur.width,
          height: (res as { height?: number }).height ?? cur.height,
        }));
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/cancel/i.test(msg)) console.warn('[chat-preview] crop failed:', e);
    } finally {
      setCropping(false);
    }
  };

  const send = async () => {
    if (sending) return;
    setSending(true);
    try {
      await pendingMediaService.sendMedia({
        conversationId,
        partnerId,
        senderId,
        local,
        body: caption.trim() || undefined,
      });
      void syncNow({ force: true });
      navigation.goBack();
    } catch (e) {
      console.warn('[chat-preview] send failed:', e);
      showAlert(t('errors.generic'));
      setSending(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        {isImage ? (
          <Pressable onPress={crop} hitSlop={12} style={styles.iconBtn} disabled={cropping}>
            {cropping ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Icon name="crop" size={22} color="#fff" />
            )}
          </Pressable>
        ) : null}
      </View>

      <View style={styles.stage}>
        <Image source={{ uri }} style={styles.media} resizeMode="contain" />
        {isVideo ? (
          <View style={styles.playBadge}>
            <Icon name="play-circle" size={64} color="#ffffffdd" />
          </View>
        ) : null}
      </View>

      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={insets.bottom}
      >
        <View style={[styles.bottom, { paddingBottom: insets.bottom + 10 }]}>
          <View style={styles.captionRow}>
            <TextInput
              value={caption}
              onChangeText={setCaption}
              placeholder={t('chat.addCaption')}
              placeholderTextColor="#ffffff88"
              style={styles.captionInput}
              multiline
            />
          </View>
          <Pressable
            onPress={send}
            disabled={sending}
            style={[styles.sendBtn, { backgroundColor: c.primary }]}
          >
            {sending ? (
              <ActivityIndicator color="#fff" size="small" />
            ) : (
              <Icon name="send" size={22} color="#fff" />
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtn: { padding: 10 },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%' },
  playBadge: { position: 'absolute' },
  bottom: { flexDirection: 'row', alignItems: 'flex-end', gap: 10, paddingHorizontal: 12 },
  captionRow: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 22,
    paddingHorizontal: 16,
    minHeight: 44,
    justifyContent: 'center',
  },
  captionInput: { color: '#fff', fontSize: 15, paddingVertical: 8, maxHeight: 110 },
  sendBtn: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
