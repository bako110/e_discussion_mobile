/**
 * Notifications natives de messages — pilotées par NOTRE WebSocket.
 *
 * Règle : on affiche une notif OS pour tout `message.new` reçu SAUF si
 * l'utilisateur regarde cette conversation au premier plan. Quand un chat
 * s'ouvre, on efface sa notif.
 *
 * Utilise `navigationRef` (pas de hook de navigation) : peut donc être monté
 * n'importe où sous les providers.
 */
import React, { useEffect, useRef } from 'react';
import { AppState } from 'react-native';

import { useAuth } from '@/context/AuthContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import { notificationRepo } from '@/db/repositories/notificationRepo';
import { activeConversationId, navigationRef } from '@/navigation/navigationRef';
import {
  clearConversationNotification,
  displayMessageNotification,
} from '@/services/notificationService';
import { getNotifPrefs } from '@/services/notificationPrefs';
import type { ChatMessage } from '@/types';

/** Libellé court d'une pièce jointe pour l'aperçu de notif (sans emoji). */
function attachmentLabel(type: string): string {
  switch (type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Vidéo';
    case 'voice':
      return 'Message vocal';
    case 'file':
      return 'Document';
    case 'location':
      return 'Position';
    default:
      return 'Nouveau message';
  }
}

export const MessageNotifications: React.FC = () => {
  const { me } = useAuth();
  const { addListener } = useWs();
  const lastActiveRef = useRef<string | null>(null);

  // efface la notif quand on ouvre une conversation (poll léger sur la route)
  useEffect(() => {
    const iv = setInterval(() => {
      const id = activeConversationId();
      if (id && id !== lastActiveRef.current) {
        lastActiveRef.current = id;
        void clearConversationNotification(id);
        void notificationRepo.markConversationRead(id);
      } else if (!id) {
        lastActiveRef.current = null;
      }
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  useEffect(() => {
    if (!me) return;
    const off = addListener((e: WsEvent) => {
      if (e.type !== 'message.new') return;
      const msg = e.message as ChatMessage | undefined;
      if (!msg) return;
      const convId = (msg as { conversation_id?: string }).conversation_id;
      if (!convId) return;

      // notifications de messages désactivées dans les réglages
      if (!getNotifPrefs().messages) return;

      // pas de notif pour mes propres messages (echo multi-device)
      const senderId = (msg as { sender_id?: string }).sender_id;
      if (senderId && senderId === me.id) return;

      // ni si je regarde déjà cette conversation, app au premier plan
      const focused = AppState.currentState === 'active';
      const onThisChat =
        navigationRef.isReady() && activeConversationId() === convId;
      if (focused && onThisChat) return;

      const sender = (msg as {
        sender?: {
          display_name?: string | null;
          username?: string | null;
          avatar_url?: string | null;
        };
      }).sender;
      const encrypted = (msg as { encrypted?: boolean }).encrypted;
      const type = (msg as { type?: string }).type ?? 'text';
      const body = (msg as { body?: string }).body ?? '';
      const preview =
        type !== 'text'
          ? attachmentLabel(type)
          : encrypted
            ? ''
            : body.slice(0, 140);

      // conversation en sourdine -> pas de notif OS (le compteur reste à jour)
      void conversationRepo.get(convId).then((conv) => {
        if (conv?.muted) return;
        void displayMessageNotification({
          conversationId: convId,
          senderId: senderId ?? '',
          senderName: sender?.display_name || sender?.username || 'Message',
          senderAvatar: sender?.avatar_url ?? null,
          preview,
          messageId: (msg as { id?: string }).id ?? '',
        });
      });
    });
    return off;
  }, [me, addListener]);

  return null;
};
