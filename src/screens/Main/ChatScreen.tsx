import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Clipboard from '@react-native-clipboard/clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { AppHeader, Avatar, Button, Icon, Screen, SyncBanner } from '@/components/common';
import { MessageBubble } from '@/components/chat/MessageBubble';
import { useAuth } from '@/context/AuthContext';
import { useCall } from '@/context/CallContext';
import { useChatPrefs } from '@/context/ChatPrefsContext';
import { useSync } from '@/context/SyncContext';
import { useTheme } from '@/context/ThemeContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { messageRepo } from '@/db/repositories/messageRepo';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import type { MainScreenProps } from '@/navigation/types';
import { conversationService, messageService } from '@/services';
import { retryFailedDecryptions, syncNow } from '@/sync/syncEngine';
import type { ChatMessage, RequestStatus } from '@/types';
import { dayLabel } from '@/utils/time';

type Item = { kind: 'msg'; m: LocalMessage } | { kind: 'day'; label: string; key: string };

function withDaySeparators(messages: LocalMessage[]): Item[] {
  // messages triés du plus récent au plus ancien (liste inversée)
  const out: Item[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    out.push({ kind: 'msg', m });
    const next = messages[i + 1];
    if (!next || new Date(m.created_at).toDateString() !== new Date(next.created_at).toDateString()) {
      out.push({ kind: 'day', label: dayLabel(m.created_at), key: `day-${m.id}` });
    }
  }
  return out;
}

export const ChatScreen: React.FC<MainScreenProps<'Chat'>> = ({ route, navigation }) => {
  const { conversationId, partnerId, partnerName, partnerAvatar } = route.params;
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const { me } = useAuth();
  const { addListener, sendTyping } = useWs();
  const { online } = useSync();
  const { wallpaper, enterToSend } = useChatPrefs();
  const { available: callsAvailable, startCall, phase: callPhase } = useCall();

  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [requestStatus, setRequestStatus] = useState<RequestStatus>('accepted');
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [partnerTyping, setPartnerTyping] = useState(false);
  // message en cours d'édition (null = mode envoi normal)
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const typingTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const myId = me?.id ?? '';

  const reload = useCallback(async () => {
    const [page, conv] = await Promise.all([
      messageService.page(conversationId, 60),
      conversationRepo.get(conversationId),
    ]);
    setMessages(page);
    if (conv) {
      setRequestStatus(conv.request_status);
      setPartnerOnline(conv.partner.is_online);
    }
    setLoading(false);
  }, [conversationId]);

  // rafraîchit le détail serveur (statut de demande, présence) à l'ouverture —
  // best-effort, l'affichage local reste la source si hors-ligne.
  const refreshDetail = useCallback(async () => {
    try {
      const d = await conversationService.detail(conversationId);
      setRequestStatus(d.request_status);
      setPartnerOnline(d.partner.is_online);
    } catch {
      /* hors-ligne — on garde le cache local */
    }
  }, [conversationId]);

  useEffect(() => {
    void reload();
    void refreshDetail();
    // marque lu (local + outbox) + tente une sync delta pour cette conv
    void messageService.markRead(conversationId, myId);
    // re-tente le déchiffrement des messages restés chiffrés, puis rafraîchit
    void retryFailedDecryptions().then((n) => {
      if (n > 0) void reload();
    });
    void syncNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  useEffect(() => {
    const off = addListener((e: WsEvent) => {
      if (e.type === 'message.new' && (e.message as ChatMessage)?.conversation_id === conversationId) {
        void messageService.ingestRealtime(e.message as ChatMessage, myId).then(reload);
        void messageService.markRead(conversationId, myId);
      } else if (e.type === 'message.deleted' && e.conversation_id === conversationId) {
        void messageRepo.markDeleted(e.message_id as string).then(reload);
      } else if (e.type === 'message.edited') {
        const em = e.message as ChatMessage | undefined;
        if (em?.conversation_id === conversationId && em.id) {
          void messageRepo
            .applyEdit(em.id, em.encrypted ? '' : em.body)
            .then(reload);
        }
      } else if (e.type === 'message.reaction') {
        void messageRepo.setReaction(e.message_id as string, (e.emoji as string) ?? null).then(reload);
      } else if (e.type === 'receipt.read' && e.conversation_id === conversationId) {
        void messageRepo.markMineRead(conversationId, myId).then(reload);
      } else if (e.type === 'receipt.delivered' && e.conversation_id === conversationId) {
        void messageRepo.markMineDelivered(e.message_id as string).then(reload);
      } else if (
        (e.type === 'typing.start' || e.type === 'typing.stop') &&
        e.conversation_id === conversationId &&
        e.user_id === partnerId
      ) {
        setPartnerTyping(e.type === 'typing.start');
      } else if (e.type === 'presence.update' && e.user_id === partnerId) {
        setPartnerOnline(!!e.online);
      } else if (e.type === 'conversation.accepted' && e.user_id === partnerId) {
        // le partenaire a accepte ma demande
        void conversationRepo.setRequestStatus(conversationId, 'accepted').then(() => {
          conversationRepo.markSynced(conversationId);
          setRequestStatus('accepted');
        });
      }
    });
    return off;
  }, [addListener, conversationId, partnerId, myId, reload]);

  const onChangeText = (v: string) => {
    setText(v);
    sendTyping(conversationId, 'start');
    if (typingTimeout.current) clearTimeout(typingTimeout.current);
    typingTimeout.current = setTimeout(() => sendTyping(conversationId, 'stop'), 1500);
  };

  const send = async () => {
    const body = text.trim();
    if (!body || sending) return;

    // mode édition : on applique la modification au lieu d'un nouvel envoi
    if (editing) {
      const target = editing;
      setEditing(null);
      setText('');
      try {
        await messageService.edit(target.id, body);
        await reload();
        void syncNow({ force: true });
      } catch (e) {
        console.warn('[ChatScreen] edit failed:', e);
        setEditing(target);
        setText(body);
        setSendError(t('errors.generic'));
      }
      return;
    }

    setSending(true);
    setSendError(null);
    const previous = text;
    setText('');
    try {
      await messageService.send({ conversationId, partnerId, senderId: myId, body });
      await reload();
      void syncNow({ force: true });
    } catch (e) {
      console.warn('[ChatScreen] send failed:', e);
      setText(previous); // on rend le texte a l'utilisateur
      setSendError(t('errors.generic'));
    } finally {
      setSending(false);
    }
  };

  /** Menu d'actions sur un message (appui long). */
  const onMessageLongPress = (m: LocalMessage) => {
    if (m.deleted_at) return;
    const isMine = m.sender_id === myId;
    const options: Array<{ text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }> = [];
    if (m.body) {
      options.push({ text: t('chat.copy'), onPress: () => Clipboard.setString(m.body) });
    }
    if (isMine && m.body && !m.encrypted) {
      options.push({
        text: t('common.edit'),
        onPress: () => {
          setEditing(m);
          setText(m.body);
        },
      });
    }
    if (isMine) {
      options.push({
        text: t('chat.deleteForEveryone'),
        style: 'destructive',
        onPress: () => void messageService.remove(m.id).then(reload),
      });
    }
    options.push({ text: t('common.cancel'), style: 'cancel' });
    Alert.alert(t('chat.messageActions'), undefined, options);
  };

  const retry = async (m: LocalMessage) => {
    if (!m.client_id) return;
    // re-enfile l'envoi et relance
    await messageService.send({
      conversationId,
      partnerId,
      senderId: myId,
      body: m.body,
    });
    await messageRepo.markDeleted(m.id); // masque l'ancienne ligne "failed"
    await reload();
    void syncNow({ force: true });
  };

  const accept = async () => {
    await conversationService.accept(conversationId);
    setRequestStatus('accepted');
    void syncNow({ force: true });
  };
  const decline = async () => {
    await conversationService.decline(conversationId);
    navigation.goBack();
  };

  const placeCall = (kind: 'voice' | 'video') => {
    if (callPhase !== 'idle') return;
    if (!callsAvailable) {
      Alert.alert(t('calls.unavailableTitle'), t('calls.unavailableBody'));
      return;
    }
    startCall(
      {
        id: partnerId,
        username: null,
        display_name: partnerName,
        avatar_url: partnerAvatar ?? null,
        about: null,
        last_seen_at: null,
        is_online: partnerOnline,
      },
      kind,
    ).catch((e: unknown) => {
      const msg = e instanceof Error ? e.message : t('calls.startFailed');
      Alert.alert(t('calls.startFailed'), msg);
    });
  };

  const c = theme.colors;
  const items = withDaySeparators(messages);

  const subtitle = partnerTyping
    ? t('common.typing')
    : partnerOnline
      ? t('common.online')
      : t('common.offline');

  // fond de conversation selon la préférence (couleur unie ou dégradé simple)
  const chatBg =
    wallpaper.key === 'default'
      ? c.chatBackground
      : wallpaper.colors[0] || c.chatBackground;

  return (
    <Screen edges={[]} style={{ backgroundColor: chatBg }}>
      {wallpaper.type === 'gradient' && wallpaper.key !== 'default' ? (
        <View
          pointerEvents="none"
          style={[
            styles.wallpaperOverlay,
            { backgroundColor: wallpaper.colors[1], opacity: 0.5 },
          ]}
        />
      ) : null}
      <AppHeader
        rounded={false}
        compact
        full={
          <>
            <Pressable onPress={() => navigation.goBack()} hitSlop={12} style={styles.backBtn}>
              <Icon name="arrow-left" size={24} color={c.onHeader} />
            </Pressable>
            <Pressable style={styles.headerId} hitSlop={6}>
              <Avatar uri={partnerAvatar} name={partnerName} size={38} online={partnerOnline} />
              <View style={styles.headerText}>
                <Text style={[styles.headerName, { color: c.onHeader }]} numberOfLines={1}>
                  {partnerName}
                </Text>
                <Text
                  style={[
                    styles.headerSub,
                    { color: partnerTyping || partnerOnline ? c.onHeader : c.onHeaderMuted },
                  ]}
                  numberOfLines={1}
                >
                  {subtitle}
                </Text>
              </View>
            </Pressable>
            <View style={styles.headerActions}>
              <Pressable hitSlop={10} onPress={() => placeCall('video')}>
                <Icon name="video-outline" size={22} color={c.onHeader} />
              </Pressable>
              <Pressable hitSlop={10} onPress={() => placeCall('voice')}>
                <Icon name="phone-outline" size={21} color={c.onHeader} />
              </Pressable>
              <Pressable hitSlop={10}>
                <Icon name="dots-vertical" size={22} color={c.onHeader} />
              </Pressable>
            </View>
          </>
        }
      />
      {!online ? (
        <View style={[styles.offlineStrip, { backgroundColor: c.surfaceAlt }]}>
          <Icon name="cloud-off-outline" size={14} color={c.textMuted} />
          <Text style={[styles.offlineText, { color: c.textMuted }]}>{t('sync.offline')}</Text>
        </View>
      ) : null}
      <SyncBanner />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : (
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
        >
          <FlatList
            data={items}
            inverted
            keyExtractor={(it) => (it.kind === 'msg' ? it.m.id : it.key)}
            contentContainerStyle={{ paddingVertical: 10 }}
            renderItem={({ item, index }) => {
              if (item.kind === 'day') {
                return (
                  <View style={styles.dayWrap}>
                    <View style={[styles.dayPill, { backgroundColor: c.surfaceAlt }]}>
                      <Text style={[styles.dayText, { color: c.textMuted }]}>{item.label}</Text>
                    </View>
                  </View>
                );
              }
              const prev = items[index + 1]; // liste inversée → suivant = plus ancien
              const grouped =
                prev?.kind === 'msg' && prev.m.sender_id === item.m.sender_id;
              return (
                <MessageBubble
                  message={item.m}
                  mine={item.m.sender_id === myId}
                  grouped={grouped}
                  onLongPress={() => onMessageLongPress(item.m)}
                  onRetry={() => retry(item.m)}
                />
              );
            }}
          />

          {requestStatus === 'pending_incoming' ? (
            <View
              style={[
                styles.requestBar,
                {
                  backgroundColor: c.surface,
                  borderTopColor: c.divider,
                  paddingBottom: 16 + insets.bottom,
                },
              ]}
            >
              <Text style={{ color: c.textMuted, marginBottom: 10 }}>
                {t('conversations.acceptRequestHint', { name: partnerName })}
              </Text>
              <View style={styles.requestActions}>
                <Button label={t('conversations.decline')} variant="secondary" onPress={decline} style={styles.flex} />
                <View style={{ width: 10 }} />
                <Button label={t('conversations.accept')} onPress={accept} style={styles.flex} />
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.composer,
                {
                  backgroundColor: c.card,
                  borderTopColor: c.divider,
                  paddingBottom: 8 + insets.bottom,
                },
              ]}
            >
              {sendError ? (
                <Text style={[styles.sendError, { color: c.danger }]}>{sendError}</Text>
              ) : null}
              {editing ? (
                <View style={[styles.editBar, { borderLeftColor: c.primary }]}>
                  <View style={styles.flex}>
                    <Text style={[styles.editLabel, { color: c.primary }]}>
                      {t('common.edit')}
                    </Text>
                    <Text style={[styles.editPreview, { color: c.textMuted }]} numberOfLines={1}>
                      {editing.body}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => {
                      setEditing(null);
                      setText('');
                    }}
                    hitSlop={8}
                  >
                    <Icon name="close" size={18} color={c.textMuted} />
                  </Pressable>
                </View>
              ) : null}
              <View style={[styles.inputWrap, { backgroundColor: c.surface }]}>
                <Pressable hitSlop={8}>
                  <Icon name="emoticon-happy-outline" size={22} color={c.textFaint} />
                </Pressable>
                <TextInput
                  value={text}
                  onChangeText={onChangeText}
                  placeholder={t('conversations.typeMessage')}
                  placeholderTextColor={c.textFaint}
                  multiline={!enterToSend}
                  blurOnSubmit={false}
                  returnKeyType={enterToSend ? 'send' : 'default'}
                  onSubmitEditing={enterToSend ? () => void send() : undefined}
                  style={[styles.input, { color: c.text }]}
                />
                <Pressable hitSlop={8}>
                  <Icon name="paperclip" size={20} color={c.textFaint} />
                </Pressable>
              </View>
              <Pressable
                onPress={send}
                disabled={!text.trim()}
                style={[styles.sendBtn, { backgroundColor: c.primary, opacity: text.trim() ? 1 : 0.45 }]}
              >
                <Icon name={text.trim() ? 'send' : 'microphone'} size={19} color="#fff" />
              </Pressable>
            </View>
          )}
        </KeyboardAvoidingView>
      )}
    </Screen>
  );
};

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  wallpaperOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  editBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderLeftWidth: 3,
    paddingLeft: 10,
    paddingVertical: 4,
    marginBottom: 6,
  },
  editLabel: { fontSize: 12, fontWeight: '800' },
  editPreview: { fontSize: 13, marginTop: 1 },
  backBtn: { paddingHorizontal: 4, paddingVertical: 4 },
  headerId: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, marginLeft: 2 },
  headerText: { flex: 1, justifyContent: 'center' },
  headerActions: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingLeft: 6 },
  headerName: { fontSize: 16.5, fontWeight: '700', letterSpacing: -0.2 },
  headerSub: { fontSize: 12, fontWeight: '500', marginTop: 1 },
  offlineStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 5,
  },
  offlineText: { fontSize: 12, fontWeight: '600' },
  dayWrap: { alignItems: 'center', marginVertical: 8 },
  dayPill: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12 },
  dayText: { fontSize: 12, fontWeight: '600' },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    flexWrap: 'wrap',
    paddingHorizontal: 8,
    paddingTop: 8,
    gap: 8,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  sendError: { width: '100%', fontSize: 12, marginBottom: 4, marginLeft: 6 },
  inputWrap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 22,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  input: {
    flex: 1,
    paddingTop: 6,
    paddingBottom: 6,
    fontSize: 15,
    maxHeight: 108,
  },
  sendBtn: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  requestBar: { padding: 16, borderTopWidth: StyleSheet.hairlineWidth },
  requestActions: { flexDirection: 'row' },
});
