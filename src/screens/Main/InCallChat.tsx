/**
 * Mini-messagerie affichée pendant un appel (panneau coulissant).
 * Réutilise la conversation 1-to-1 chiffrée (messageService). Les messages
 * envoyés/reçus ici sont les mêmes que dans l'écran de discussion.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Icon } from '@/components/common';
import { useAuth } from '@/context/AuthContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import type { LocalMessage } from '@/db/repositories/messageRepo';
import { conversationService, messageService } from '@/services';
import type { ChatMessage } from '@/types';

interface Props {
  partnerId: string;
  partnerName: string;
  onClose: () => void;
}

export const InCallChat: React.FC<Props> = ({ partnerId, partnerName, onClose }) => {
  const { me } = useAuth();
  const { addListener } = useWs();
  const myId = me?.id ?? '';

  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<LocalMessage>>(null);

  // résout la conversation (crée si besoin) puis charge la dernière page
  useEffect(() => {
    let alive = true;
    conversationService
      .start(partnerId)
      .then(async (detail) => {
        if (!alive) return;
        setConversationId(detail.id);
        const page = await messageService.page(detail.id, 40);
        if (alive) setMessages(page);
        void messageService.markRead(detail.id, myId);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [partnerId, myId]);

  const reload = useCallback(
    (cid: string) => messageService.page(cid, 40).then(setMessages),
    [],
  );

  // messages entrants en temps réel — il faut INGÉRER le message reçu
  // (déchiffrement + stockage SQLite) avant de relire la page locale,
  // comme le fait ChatScreen. Sinon `page()` ne renvoie rien de nouveau.
  useEffect(() => {
    if (!conversationId) return;
    const off = addListener((e: WsEvent) => {
      if (conversationId == null) return;
      if (e.type === 'message.new') {
        const m = e.message as ChatMessage | undefined;
        if (!m || m.conversation_id !== conversationId) return;
        void messageService.ingestRealtime(m, myId).then(() => void reload(conversationId));
        void messageService.markRead(conversationId, myId);
      } else if (e.type === 'message.edited') {
        const m = e.message as ChatMessage | undefined;
        if (m?.conversation_id === conversationId) void reload(conversationId);
      } else if (e.type === 'message.deleted' && e.conversation_id === conversationId) {
        void reload(conversationId);
      }
    });
    return off;
  }, [conversationId, addListener, myId, reload]);

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || !conversationId) return;
    setText('');
    try {
      await messageService.send({ conversationId, partnerId, senderId: myId, body });
      await reload(conversationId);
      requestAnimationFrame(() => listRef.current?.scrollToOffset({ offset: 0, animated: true }));
    } catch {
      /* l'outbox retentera */
    }
  }, [text, conversationId, partnerId, myId, reload]);

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1}>
          {partnerName}
        </Text>
        <Pressable onPress={onClose} hitSlop={12}>
          <Icon name="chevron-down" size={26} color="#cdd8ec" />
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={messages}
        inverted
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="handled"
        renderItem={({ item }) => {
          const mine = item.sender_id === myId;
          return (
            <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
              <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleTheirs]}>
                <Text style={styles.bubbleText}>{item.body || '···'}</Text>
              </View>
            </View>
          );
        }}
      />

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Message"
          placeholderTextColor="#7b8aa6"
          multiline
          returnKeyType="send"
          onSubmitEditing={() => void send()}
        />
        <Pressable
          onPress={() => void send()}
          disabled={!text.trim()}
          style={[styles.sendBtn, !text.trim() && styles.sendBtnOff]}
        >
          <Icon name="send" size={20} color="#fff" />
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '62%',
    backgroundColor: '#111A2C',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#ffffff1a',
  },
  title: { color: '#fff', fontSize: 15, fontWeight: '700', flex: 1 },
  list: { paddingHorizontal: 12, paddingVertical: 10, gap: 6 },
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 14 },
  bubbleMine: { backgroundColor: '#2F80ED', borderBottomRightRadius: 4 },
  bubbleTheirs: { backgroundColor: '#22304a', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#fff', fontSize: 14, lineHeight: 19 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 6,
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    backgroundColor: '#1c2740',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    color: '#fff',
    fontSize: 15,
  },
  sendBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#2F80ED',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnOff: { opacity: 0.4 },
});
