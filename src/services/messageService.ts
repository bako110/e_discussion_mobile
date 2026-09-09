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
import { newClientId, notifyMutationApplied, outbox } from '@/sync/outbox';
import { messageService as netMessageService } from './messageService.net';

/** Libellé court pour l'aperçu d'une conversation quand le message n'a pas de texte. */
function attachmentPreview(type: MessageType): string {
  switch (type) {
    case 'image':
      return '📷 Photo';
    case 'video':
      return '🎬 Vidéo';
    case 'voice':
      return '🎤 Message vocal';
    case 'file':
      return '📎 Document';
    case 'location':
      return '📍 Position';
    default:
      return '';
  }
}

interface SendParams {
  conversationId: string;
  partnerId: string;
  senderId: string;
  type?: MessageType;
  body?: string;
  /** URL renvoyée par l'upload média (photo/vidéo/fichier/vocal). */
  attachmentUrl?: string | null;
  /** Métadonnées de la pièce jointe : durée, dimensions, nom, lat/lng… */
  attachmentMeta?: Record<string, unknown> | null;
  replyTo?: ReplyPreview | null;
}

export const messageService = {
  /** Page locale (instantanée, hors-ligne OK). */
  page(conversationId: string, limit = 40, beforeCreatedAt?: string): Promise<LocalMessage[]> {
    return messageRepo.page(conversationId, limit, beforeCreatedAt);
  },

  /** Envoi local-first :
   *  1. insère la bulle optimiste TOUT DE SUITE (⏱) et la renvoie ;
   *  2. chiffre + empile l'outbox de façon FIABLE (persistée) en arrière-plan.
   *
   * Le chiffrement E2E peut coûter un aller-retour réseau au 1er message d'une
   * conversation (fetch du bundle X3DH) — ensuite le bundle est en cache. On ne
   * fait plus attendre l'UI, MAIS l'`enqueue` est garanti : en cas d'échec du
   * chiffrement on part en clair ; en cas d'échec de l'`enqueue` lui-même on
   * marque la ligne `failed` (l'utilisateur peut ré-appuyer). */
  async send(p: SendParams): Promise<LocalMessage> {
    const type = p.type ?? 'text';
    const plain = (p.body ?? '').trim();
    const hasAttachment = !!p.attachmentUrl || (type === 'location' && !!p.attachmentMeta);
    if (!plain && !p.replyTo && !hasAttachment) throw new Error('empty message');

    const clientId = newClientId();
    const createdAt = new Date().toISOString();

    // 1) bulle optimiste immédiate (⏱)
    await messageRepo.insertOutgoing({
      clientId,
      conversationId: p.conversationId,
      senderId: p.senderId,
      type,
      body: plain,
      bodyCipher: null,
      encrypted: false,
      attachmentUrl: p.attachmentUrl ?? null,
      attachmentMeta: p.attachmentMeta ?? null,
      replyTo: p.replyTo,
      createdAt,
    });
    const preview = plain || attachmentPreview(type);
    try {
      await conversationRepo.touchLastMessage(p.conversationId, preview, type, false, createdAt);
    } catch (e) {
      console.warn('[send] touchLastMessage:', String(e));
    }

    // 2) chiffrement + enqueue FIABLE en arrière-plan
    void (async () => {
      let cipher: string | null = null;
      let encrypted = false;
      if (type === 'text' && plain) {
        try {
          const payload = await encryptMessageForUser(p.partnerId, plain);
          cipher = JSON.stringify(payload);
          encrypted = true;
          await messageRepo.setEncrypted(clientId, cipher);
        } catch (e) {
          console.warn('[send] E2E indisponible, envoi en clair:', String(e));
        }
      }
      try {
        await outbox.enqueue('send_message', clientId, {
          conversationId: p.conversationId,
          type,
          body: encrypted ? cipher : plain,
          plainBody: plain,
          encrypted,
          attachmentUrl: p.attachmentUrl ?? undefined,
          attachmentMeta: p.attachmentMeta ?? undefined,
          replyToId: p.replyTo?.id,
        });
      } catch (e) {
        console.warn('[send] enqueue a échoué:', String(e));
        await messageRepo.markFailed(clientId).catch(() => undefined);
        notifyMutationApplied({ conversationId: p.conversationId });
      }
    })();

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

  /** Récupère les messages `pending` restés SANS entrée d'outbox (app tuée
   * entre l'insert optimiste et l'enqueue) et les ré-empile. À appeler au
   * démarrage / à l'ouverture d'un chat. */
  async recoverOrphanPending(myId: string): Promise<number> {
    if (!myId) return 0;
    const orphans = await messageRepo.listOrphanPending(myId);
    for (const m of orphans) {
      const cid = m.client_id ?? m.id;
      let body = m.body;
      let encrypted = false;
      // on re-chiffre si possible (le blob local a pu ne jamais être calculé)
      if (m.type === 'text' && m.body) {
        try {
          // partenaire = l'autre participant : on le déduit via la conv locale
          const conv = await conversationRepo.get(m.conversation_id);
          if (conv?.partner?.id) {
            const payload = await encryptMessageForUser(conv.partner.id, m.body);
            body = JSON.stringify(payload);
            encrypted = true;
            await messageRepo.setEncrypted(cid, body);
          }
        } catch {
          /* on part en clair */
        }
      }
      await outbox.enqueue('send_message', cid, {
        conversationId: m.conversation_id,
        type: m.type,
        body: encrypted ? body : m.body,
        plainBody: m.body,
        encrypted,
      });
    }
    return orphans.length;
  },
};
