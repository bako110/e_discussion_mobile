/**
 * Ingestion TEMPS RÉEL des messages entrants — global, indépendant de l'écran
 * ouvert.
 *
 * Sans ça, un `message.new` n'était écrit en base que si le ChatScreen concerné
 * était affiché : en revenant sur la conversation on ne voyait le message
 * qu'après un `pullDeltas` (lent). Ici on :
 *   1. ingère CHAQUE `message.new` / `group.message` dans SQLite tout de suite ;
 *   2. envoie l'accusé « remis » par la WebSocket (instantané, pas d'HTTP) ;
 *   3. relaie un event interne `local.message.ingested` pour que l'écran ouvert
 *      se rafraîchisse.
 *
 * Monté une fois sous `WebSocketProvider` (voir RootNavigator).
 */
import { useEffect } from 'react';

import { useAuth } from '@/context/AuthContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { messageRepo } from '@/db/repositories/messageRepo';
import { messageService, groupService } from '@/services';
import { setOnMutationApplied } from '@/sync/outbox';
import { retryFailedDecryptions } from '@/sync/syncEngine';
import type { ChatMessage, GroupMessage } from '@/types';

/** Bus interne ultra-léger : les écrans s'y abonnent pour recharger leur liste.
 * `incoming` = message reçu d'un pair (déclenche un markRead) ; absent/false
 * = simple confirmation d'un de NOS messages (bulle ⏱ -> ✓). */
type LocalListener = (e: {
  type: string;
  conversationId?: string;
  groupId?: string;
  incoming?: boolean;
}) => void;
const localListeners = new Set<LocalListener>();
export function onLocalMessageEvent(fn: LocalListener): () => void {
  localListeners.add(fn);
  return () => localListeners.delete(fn);
}
function emitLocal(e: Parameters<LocalListener>[0]): void {
  localListeners.forEach((fn) => {
    try {
      fn(e);
    } catch {
      /* un abonné ne casse pas les autres */
    }
  });
}

export const MessageSync: React.FC = () => {
  const { me } = useAuth();
  const { addListener, send } = useWs();

  // pont : une mutation confirmée par le serveur (bulle ⏱ -> ✓) doit
  // rafraîchir l'écran ouvert, comme un message entrant.
  useEffect(() => {
    setOnMutationApplied((info) => {
      emitLocal({
        type: info.groupId ? 'group' : 'message',
        conversationId: info.conversationId,
        groupId: info.groupId,
      });
    });
    return () => setOnMutationApplied(null);
  }, []);

  useEffect(() => {
    if (!me) return;
    const myId = me.id;

    const off = addListener((e: WsEvent) => {
      // ── 1-to-1 ────────────────────────────────────────────────────────
      if (e.type === 'message.new') {
        const msg = e.message as ChatMessage | undefined;
        if (!msg?.conversation_id) return;
        const mine = msg.sender_id === myId;

        void messageService
          .ingestRealtime(msg, myId)
          .then(async (local) => {
            emitLocal({
              type: 'message',
              conversationId: msg.conversation_id,
              incoming: !mine,
            });
            // reçu mais indéchiffrable ? la session vient peut-être d'être
            // établie -> on retente tout de suite (puis on re-notifie l'écran).
            if (local?.decryptFailed) {
              const n = await retryFailedDecryptions();
              if (n > 0) {
                emitLocal({
                  type: 'message',
                  conversationId: msg.conversation_id,
                  incoming: !mine,
                });
              }
            }
          })
          .catch(() => undefined);

        // accusé « remis » IMMÉDIAT par la WS (le pair voit ✓✓ tout de suite)
        if (!mine && msg.id) {
          send({ type: 'delivered', message_id: msg.id });
        }
        return;
      }

      // ── accusés reçus (globaux : la coche se met à jour même hors du chat)
      if (e.type === 'receipt.delivered' && (e.message_id || e.client_id)) {
        // essaie l'id serveur PUIS le client_id (ligne locale pas encore confirmée)
        void (async () => {
          if (e.message_id) await messageRepo.markMineDelivered(e.message_id as string);
          if (e.client_id) await messageRepo.markMineDelivered(e.client_id as string);
          emitLocal({ type: 'message', conversationId: e.conversation_id as string });
        })().catch(() => undefined);
        return;
      }
      if (e.type === 'receipt.read' && e.conversation_id) {
        void messageRepo
          .markMineRead(e.conversation_id as string, myId)
          .then(() => emitLocal({ type: 'message', conversationId: e.conversation_id as string }))
          .catch(() => undefined);
        return;
      }

      // ── groupes ──────────────────────────────────────────────────────
      if (e.type === 'group.message') {
        const gm = e.message as GroupMessage | undefined;
        if (!gm?.group_id) return;
        const mine = gm.sender_id === myId;
        void groupService
          .ingestRealtime(gm)
          .then(() => emitLocal({ type: 'group', groupId: gm.group_id, incoming: !mine }))
          .catch(() => undefined);
      }
    });

    return off;
  }, [me, addListener, send]);

  return null;
};
