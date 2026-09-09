/**
 * Messages — LOCAL-FIRST. On lit toujours la base SQLite locale ; on écrit en
 * local + on empile la mutation dans l'outbox. Le `syncEngine` pousse au
 * serveur dès que possible (idempotence via `client_id`).
 *
 * Le chiffrement de bout en bout (Signal) est appliqué au moment de
 * l'insertion locale : `body` reste en clair localement, `body_cipher` (le
 * blob à transmettre) part dans le payload de l'outbox.
 */
import { encryptMessageForUser } from '@/crypto';
import { messageRepo, type LocalMessage } from '@/db/repositories/messageRepo';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import type { ChatMessage, MessageType, ReplyPreview } from '@/types';
import { newClientId, outbox } from '@/sync/outbox';
import { messageService as netMessageService } from './messageService.net';

interface SendParams {
  conversationId: string;
  partnerId: string;
  senderId: string;
  type?: MessageType;
  body?: string;
  replyTo?: ReplyPreview | null;
}

export const messageService = {
  /** Page locale (instantanée, hors-ligne OK). */
  page(conversationId: string, limit = 40, beforeCreatedAt?: string): Promise<LocalMessage[]> {
    return messageRepo.page(conversationId, limit, beforeCreatedAt);
  },

  /** Envoi local-first : insère en `pending`, empile l'outbox, retourne
   * immédiatement le message optimiste. Ne lève JAMAIS silencieusement :
   * si l'insert local rate, on remonte l'erreur pour l'afficher. */
  async send(p: SendParams): Promise<LocalMessage> {
    const type = p.type ?? 'text';
    const plain = (p.body ?? '').trim();
    if (!plain && !p.replyTo) throw new Error('empty message');

    const clientId = newClientId();
    const createdAt = new Date().toISOString();

    // Chiffrement E2E — best effort. Un echec (pas de cles du destinataire,
    // erreur crypto, réseau pour le bundle) NE DOIT PAS bloquer l'envoi :
    // on retombe en clair. `encryptMessageForUser` peut lever, d'ou le try.
    let cipher: string | null = null;
    let encrypted = false;
    if (type === 'text' && plain) {
      try {
        const payload = await encryptMessageForUser(p.partnerId, plain);
        cipher = JSON.stringify(payload);
        encrypted = true;
      } catch (e) {
        console.warn('[send] E2E indisponible, envoi en clair:', String(e));
      }
    }

    // 1) insertion locale du message optimiste
    await messageRepo.insertOutgoing({
      clientId,
      conversationId: p.conversationId,
      senderId: p.senderId,
      type,
      body: plain,
      bodyCipher: cipher,
      encrypted,
      replyTo: p.replyTo,
      createdAt,
    });

    // 2) MAJ de l'apercu de la conversation (best-effort — si la conv locale
    //    n'existe pas encore, l'UPDATE ne touche rien, pas grave)
    try {
      await conversationRepo.touchLastMessage(p.conversationId, plain, type, encrypted, createdAt);
    } catch (e) {
      console.warn('[send] touchLastMessage:', String(e));
    }

    // 3) file d'attente vers le serveur
    await outbox.enqueue('send_message', clientId, {
      conversationId: p.conversationId,
      type,
      body: encrypted ? cipher : plain,
      plainBody: plain,
      encrypted,
      replyToId: p.replyTo?.id,
    });

    const local = await messageRepo.getByClientId(clientId);
    if (!local) throw new Error('message local introuvable apres insertion');
    return local;
  },

  async react(messageId: string, emoji: string | null): Promise<void> {
    await messageRepo.setReaction(messageId, emoji);
    await outbox.enqueue('react', newClientId(), { messageId, emoji });
  },

  /** Édition local-first : on met à jour le texte en local + `edited_at`, puis
   * on empile la mutation. Ne modifie pas le blob chiffré local (le serveur
   * relaie le nouveau texte au partenaire via l'event `message.edited`). */
  async edit(messageId: string, body: string): Promise<void> {
    const plain = body.trim();
    if (!plain) return;
    await messageRepo.applyEdit(messageId, plain);
    await outbox.enqueue('edit', newClientId(), { messageId, body: plain });
  },

  async remove(messageId: string): Promise<void> {
    await messageRepo.markDeleted(messageId);
    await outbox.enqueue('delete', newClientId(), { messageId });
  },

  /** Marque lu en local + empile (dédupliqué : une seule entrée mark_read en
   * attente par conversation suffit, mais l'idempotence serveur le tolère). */
  async markRead(conversationId: string, myId: string): Promise<void> {
    await messageRepo.markConversationRead(conversationId, myId);
    await conversationRepo.setUnread(conversationId, 0);
    await outbox.enqueue('mark_read', newClientId(), { conversationId });
  },

  /**
   * Applique un message reçu par WebSocket (`message.new`). Peut aussi
   * concerner NOTRE propre message (le serveur echo au sender via un autre
   * appareil) — dans ce cas on garde le texte clair local.
   */
  async ingestRealtime(msg: ChatMessage, myId?: string): Promise<LocalMessage | null> {
    const mine = !!myId && msg.sender_id === myId;

    if (mine) {
      const local = msg.client_id
        ? await messageRepo.getByClientId(msg.client_id)
        : await messageRepo.getById(msg.id);
      const plain = local?.body ?? (msg.encrypted ? '' : msg.body);
      await messageRepo.upsertFromServer(msg, {
        mine: true,
        clientId: msg.client_id ?? null,
        plainBody: plain,
      });
      await conversationRepo.touchLastMessage(
        msg.conversation_id,
        plain,
        msg.type,
        msg.encrypted,
        msg.created_at,
      );
      return messageRepo.getById(msg.id);
    }

    const decrypted = await netMessageService.decryptIfNeeded(msg);
    await messageRepo.upsertFromServer(decrypted, {
      clientId: msg.client_id ?? null,
      decryptFailed: !!decrypted.decryptFailed,
      // conserve le blob d'origine pour re-tenter si l'echec est transitoire
      cipherBody: decrypted.decryptFailed && msg.encrypted ? msg.body : null,
    });
    await conversationRepo.touchLastMessage(
      msg.conversation_id,
      decrypted.decryptFailed ? '' : decrypted.body,
      msg.type,
      msg.encrypted,
      msg.created_at,
    );
    // accuse de reception « remis » — best-effort, ne bloque rien
    void netMessageService.ackDelivered(msg.id);
    return messageRepo.getById(msg.id);
  },

  listFailed(): Promise<LocalMessage[]> {
    return messageRepo.listFailed();
  },
};
