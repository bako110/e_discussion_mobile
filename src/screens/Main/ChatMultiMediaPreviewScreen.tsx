/**
 * Aperçu de PLUSIEURS photos avant envoi groupé dans une conversation
 * (façon WhatsApp) : grille de vignettes en bas, image active en grand,
 * une seule légende — appliquée à la DERNIÈRE photo envoyée. Chaque photo
 * part comme un message SÉPARÉ (via `pendingMediaService.sendMedia`, en
 * série), offline-first comme l'envoi d'une seule image.
 */
import React, { useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Icon, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { pendingMediaService } from '@/services';
import { syncNow } from '@/sync/syncEngine';
import type { LocalMediaFile } from '@/hooks/useMediaPicker';
import { asDisplayUri } from '@/utils/imageEdit';

export const ChatMultiMediaPreviewScreen: React.FC<MainScreenProps<'ChatMultiMediaPreview'>> = ({
  route,
  navigation,
}) => {
  const { conversationId, partnerId, senderId, locals: initialLocals } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const c = theme.colors;

  const [locals, setLocals] = useState<LocalMediaFile[]>(initialLocals);
  const [activeIndex, setActiveIndex] = useState(0);
  const [caption, setCaption] = useState('');
  const [sending, setSending] = useState(false);
  const [progress, setProgress] = useState(0);

  const active = locals[Math.min(activeIndex, locals.length - 1)];

  const removeAt = (idx: number) => {
    setLocals((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      if (next.length === 0) {
        // plus aucune image -> rien à envoyer, retour direct
        setTimeout(() => navigation.goBack(), 0);
      }
      return next;
    });
    setActiveIndex((i) => Math.max(0, Math.min(i, locals.length - 2)));
  };

  const send = async () => {
    if (sending || locals.length === 0) return;
    setSending(true);
    setProgress(0);
    const trimmedCaption = caption.trim();
    let okCount = 0;
    try {
      for (let i = 0; i < locals.length; i++) {
        const isLast = i === locals.length - 1;
        try {
          await pendingMediaService.sendMedia({
            conversationId,
            partnerId,
            senderId,
            local: locals[i]!,
            // légende UNIQUEMENT sur la dernière image, façon WhatsApp
            body: isLast && trimmedCaption ? trimmedCaption : undefined,
          });
          okCount++;
        } catch (e) {
          console.warn('[chat-multi-preview] send failed for item', i, e);
        }
        setProgress(i + 1);
      }
      void syncNow({ force: true });
      if (okCount < locals.length) {
        showAlert(t('chat.multiSendPartial', { ok: okCount, failed: locals.length - okCount }));
      }
      navigation.goBack();
    } finally {
      setSending(false);
    }
  };

  if (!active) return null;

  const uri = asDisplayUri(active.file.uri);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.iconBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.counter}>{t('chat.multiCounter', { current: activeIndex + 1, total: locals.length })}</Text>
        <Pressable onPress={() => removeAt(activeIndex)} hitSlop={12} style={styles.iconBtn}>
          <Icon name="trash-can-outline" size={22} color="#fff" />
        </Pressable>
      </View>

      <View style={styles.stage}>
        <Image
          source={{ uri }}
          style={styles.media}
          resizeMode="contain"
          onError={(e) => console.warn('[chat-multi-preview] image error:', e.nativeEvent)}
        />
      </View>

      <FlatList
        horizontal
        data={locals}
        keyExtractor={(item, i) => `${item.file.uri}-${i}`}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.thumbRow}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => setActiveIndex(index)}>
            <Image
              source={{ uri: asDisplayUri(item.file.uri) }}
              style={[
                styles.thumb,
                index === activeIndex && { borderColor: c.primary, borderWidth: 2 },
              ]}
            />
          </Pressable>
        )}
      />

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
              <View style={styles.sendingWrap}>
                <ActivityIndicator color="#fff" size="small" />
                <Text style={styles.sendingTxt}>
                  {progress}/{locals.length}
                </Text>
              </View>
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
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  iconBtn: { padding: 10 },
  counter: { color: '#fff', fontSize: 13, fontWeight: '700' },
  stage: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  media: { width: '100%', height: '100%' },
  thumbRow: { paddingHorizontal: 10, paddingVertical: 8, gap: 8 },
  thumb: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#222' },
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
  sendingWrap: { alignItems: 'center', gap: 2 },
  sendingTxt: { color: '#fff', fontSize: 9, fontWeight: '700' },
});
