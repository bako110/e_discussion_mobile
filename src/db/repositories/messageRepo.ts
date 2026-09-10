import { query, run } from '@/db';
import type { ChatMessage, MessageType, ReplyPreview } from '@/types';

export type SyncState = 'synced' | 'pending' | 'failed';

/**
 * Vrai si `body` est en réalité un blob chiffré (EncryptedPayload JSON) qui a
 * fui dans la colonne `body` — ne doit JAMAIS être affiché tel quel. Garde-fou
 * contre les régressions du pipeline de déchiffrement : mieux vaut afficher
 * « message chiffré » qu'un pavé de JSON illisible.
 */
export function looksEncrypted(body: string | null | undefined): boolean {
  if (!body || body[0] !== '{' || body.length < 20) return false;
  // rapide : les marqueurs distinctifs d'un EncryptedPayload
  if (!body.includes('"ciphertext"')) return false;
  return body.includes('"senderDeviceId"') || body.includes('"contentType"');
}

interface Row {
  id: string;
  client_id: string | null;
  conversation_id: string;
  sender_id: string;
  type: string;
  body: string;
  body_cipher: string | null;
  encrypted: number;
  attachment_url: string | null;
  attachment_meta: string | null;
  reply_to_json: string | null;
  reaction: string | null;
  delivered: number;
  read: number;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sync_state: string;
  decrypt_failed: number;
  voice_played: number;
}

export interface LocalMessage extends ChatMessage {
  client_id: string | null;
  sync_state: SyncState;
  /** vocal/vidéo REÇU : `true` si je l'ai déjà écouté / ouvert. */
  voicePlayed: boolean;
}

function toMsg(r: Row): LocalMessage {
  // Garde-fou lecture : si un blob chiffré a fui dans `body`, on ne l'affiche
  // pas — on bascule sur l'état « message chiffré » (decryptFailed + body vide).
  const leaked = looksEncrypted(r.body);
  const body = leaked ? '' : r.body;
  // Seul le texte a pu être chiffré : un vocal / média ne doit jamais tomber
  // dans l'état « indisponible », même si une ancienne ligne a decrypt_failed=1.
  const decryptFailed = r.type !== 'text' ? false : leaked ? true : !!r.decrypt_failed;
  return {
    id: r.id,
    client_id: r.client_id,
    conversation_id: r.conversation_id,
    sender_id: r.sender_id,
    type: r.type as MessageType,
    body,
    encrypted: !!r.encrypted,
    attachment_url: r.attachment_url,
    attachment_meta: r.attachment_meta ? (JSON.parse(r.attachment_meta) as Record<string, unknown>) : null,
    reply_to: r.reply_to_json ? (JSON.parse(r.reply_to_json) as ReplyPreview) : null,
    forwarded_from_id: null,
    reaction: r.reaction,
    delivered: !!r.delivered,
    read: !!r.read,
    edited_at: r.edited_at,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    decrypted: true,
    decryptFailed,
    voicePlayed: !!r.voice_played,
    sync_state: r.sync_state as SyncState,
    pending: r.sync_state !== 'synced',
  };
}

export const messageRepo = {
  async page(conversationId: string, limit = 40, beforeCreatedAt?: string): Promise<LocalMessage[]> {
    const rows = beforeCreatedAt
      ? await query<Row>(
          `SELECT * FROM messages WHERE conversation_id=? AND created_at < ?
             ORDER BY created_at DESC LIMIT ?`,
          [conversationId, beforeCreatedAt, limit],
        )
      : await query<Row>(
          'SELECT * FROM messages WHERE conversation_id=? ORDER BY created_at DESC LIMIT ?',
          [conversationId, limit],
        );
    return rows.map(toMsg);
  },

  async getByClientId(clientId: string): Promise<LocalMessage | null> {
    const rows = await query<Row>('SELECT * FROM messages WHERE client_id=?', [clientId]);
    return rows[0] ? toMsg(rows[0]) : null;
  },

  async getById(id: string): Promise<LocalMessage | null> {
    const rows = await query<Row>('SELECT * FROM messages WHERE id=? OR client_id=?', [id, id]);
    return rows[0] ? toMsg(rows[0]) : null;
  },

  /** Insert optimiste d'un message qu'on vient d'envoyer localement.
   * Leve si l'INSERT echoue reellement (pour ne pas "perdre" un envoi en
   * silence) — sauf collision de client_id (rejeu inoffensif). */
  async insertOutgoing(m: {
    clientId: string;
    conversationId: string;
    senderId: string;
    type: MessageType;
    body: string;
    bodyCipher?: string | null;
    encrypted: boolean;
    attachmentUrl?: string | null;
    attachmentMeta?: Record<string, unknown> | null;
    replyTo?: ReplyPreview | null;
    createdAt: string;
  }): Promise<void> {
    try {
      await run(
        `INSERT INTO messages
          (id, client_id, conversation_id, sender_id, type, body, body_cipher, encrypted,
           attachment_url, attachment_meta, reply_to_json, created_at, sync_state, voice_played)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'pending', 1)`,
        [
          m.clientId,
          m.clientId,
          m.conversationId,
          m.senderId,
          m.type,
          m.body,
          m.bodyCipher ?? null,
          m.encrypted ? 1 : 0,
          m.attachmentUrl ?? null,
          m.attachmentMeta ? JSON.stringify(m.attachmentMeta) : null,
          m.replyTo ? JSON.stringify(m.replyTo) : null,
          m.createdAt,
        ],
      );
    } catch (e) {
      const msg = String(e);
      if (msg.includes('UNIQUE') || msg.includes('constraint')) return; // rejeu
      throw e;
    }
  },

  /** Le serveur a confirmé : on remplace l'id local par l'id serveur et on
   * garde le texte CLAIR (server.body doit deja etre le plaintext). Pour un
   * média différé, on adopte l'URL/meta du serveur (source de vérité) si
   * elle est fournie — sinon on garde la valeur locale (URL déjà posée par
   * `setAttachment`). */
  async confirmSent(clientId: string, server: ChatMessage): Promise<void> {
    // `delivered`/`read` : on ne REDESCEND jamais (un `receipt.delivered` a pu
    // arriver AVANT la confirmation du POST -> MAX pour garder ✓✓).
    await run(
      `UPDATE messages
         SET id=?, body=?, encrypted=?, created_at=?,
             delivered=MAX(delivered, ?), read=MAX(read, ?),
             attachment_url=COALESCE(?, attachment_url),
             attachment_meta=COALESCE(?, attachment_meta),
             decrypt_failed=0, sync_state='synced'
       WHERE client_id=?`,
      [
        server.id,
        server.body,
        server.encrypted ? 1 : 0,
        server.created_at,
        server.delivered ? 1 : 0,
        server.read ? 1 : 0,
        server.attachment_url ?? null,
        server.attachment_meta ? JSON.stringify(server.attachment_meta) : null,
        clientId,
      ],
    );
  },

  async markFailed(clientId: string): Promise<void> {
    await run("UPDATE messages SET sync_state='failed' WHERE client_id=?", [clientId]);
  },

  /** Le chiffrement E2E (asynchrone) a abouti : on stocke le blob à transmettre
   * et on marque la ligne comme chiffrée (le texte clair `body` reste local). */
  async setEncrypted(clientId: string, cipher: string): Promise<void> {
    await run('UPDATE messages SET body_cipher=?, encrypted=1 WHERE client_id=?', [cipher, clientId]);
  },

  /** Média différé enfin uploadé : on remplace l'URI locale par l'URL serveur
   * (la ligne reste `pending` tant que le message n'est pas confirmé). */
  async setAttachment(
    clientId: string,
    url: string,
    meta: Record<string, unknown> | null,
  ): Promise<void> {
    await run(
      'UPDATE messages SET attachment_url=?, attachment_meta=? WHERE client_id=?',
      [url, meta ? JSON.stringify(meta) : null, clientId],
    );
  },

  /**
   * Upsert d'un message venant du serveur (WS ou pull delta).
   *
   * Deux pieges evites :
   *  1. Doublon : une ligne locale envoyee par nous porte d'abord id=client_id,
   *     puis id=serverId apres confirmSent. Si le pull arrive AVANT confirmSent,
   *     un simple INSERT ON CONFLICT(id) creerait une 2e ligne. On corrige donc
   *     d'abord toute ligne locale non confirmee de la meme conversation dont le
   *     `plainBody` correspond, en lui posant l'id serveur.
   *  2. Contenu chiffre : `body` cote serveur est le blob chiffre. Pour NOS
   *     propres messages, on ne peut pas le dechiffrer (pas de session avec
   *     soi-meme) — on garde donc le texte clair deja stocke en local
   *     (`plainBody` passe par l'appelant). Pour les messages recus, l'appelant
   *     a deja tente le dechiffrement (decryptIfNeeded).
   */
  async upsertFromServer(
    m: ChatMessage,
    opts?: {
      plainBody?: string;
      mine?: boolean;
      clientId?: string | null;
      decryptFailed?: boolean;
      /** Blob chiffré d'origine, conservé pour re-tenter le déchiffrement. */
      cipherBody?: string | null;
    },
  ): Promise<void> {
    // (1) recolle une ligne locale "pending" a l'id serveur si on la reconnait
    if (opts?.clientId) {
      await run(
        `UPDATE messages SET id=?, sync_state='synced', delivered=MAX(delivered,?), read=MAX(read,?)
         WHERE client_id=? AND id<>?`,
        [m.id, m.delivered ? 1 : 0, m.read ? 1 : 0, opts.clientId, m.id],
      );
    } else if (opts?.mine && opts.plainBody) {
      await run(
        `UPDATE messages SET id=?, sync_state='synced'
         WHERE conversation_id=? AND sender_id=? AND sync_state='pending' AND body=? AND id<>?`,
        [m.id, m.conversation_id, m.sender_id, opts.plainBody, m.id],
      );
    }

    // (2) corps a stocker : le clair si on l'a, sinon rien (jamais un texte
    //     d'erreur, jamais un blob chiffre). `decrypt_failed` NE VAUT JAMAIS 1
    //     pour NOS messages (on garde le clair local via plainBody).
    let body = opts?.plainBody ?? (opts?.decryptFailed ? '' : m.body);
    let leaked = false;
    if (looksEncrypted(body)) {
      // un blob chiffre a fui ici (echec de dechiffrement non signale, message
      // d'un autre appareil sans texte local, etc.) -> on ne l'ecrit pas.
      body = '';
      leaked = true;
    }
    const dfail = opts?.mine ? 0 : opts?.decryptFailed || leaked ? 1 : 0;

    // Sur echec de dechiffrement d'un message RECU, on conserve le blob chiffre
    // dans `body_cipher` pour pouvoir re-tenter plus tard (session pas encore
    // etablie, prekey pas fetchee...). Voir retryFailedDecryptions().
    const cipherToKeep =
      !opts?.mine && dfail
        ? opts?.cipherBody ?? (looksEncrypted(m.body) ? m.body : null)
        : null;

    // vocal/vidéo REÇU -> point bleu « non écouté » (0). Le mien ou tout autre
    // type -> 1 (rien à signaler).
    const vplayed =
      !opts?.mine && (m.type === 'voice' || m.type === 'video') ? 0 : 1;

    await run(
      `INSERT INTO messages
        (id, conversation_id, sender_id, type, body, body_cipher, encrypted, attachment_url, attachment_meta,
         reply_to_json, reaction, delivered, read, edited_at, deleted_at, created_at, sync_state, decrypt_failed, voice_played)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'synced', ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         body=CASE WHEN excluded.body <> '' THEN excluded.body ELSE messages.body END,
         body_cipher=CASE
           WHEN messages.body <> '' THEN NULL
           WHEN excluded.body_cipher IS NOT NULL THEN excluded.body_cipher
           ELSE messages.body_cipher END,
         encrypted=excluded.encrypted, reaction=excluded.reaction,
         -- pièce jointe : ne JAMAIS écraser une URL/meta locale par un NULL
         -- serveur (l'aperçu local file://… reste tant que l'upload différé
         -- n'a pas renvoyé l'URL). On adopte la valeur serveur seulement si
         -- elle est renseignée.
         attachment_url=COALESCE(excluded.attachment_url, messages.attachment_url),
         attachment_meta=COALESCE(excluded.attachment_meta, messages.attachment_meta),
         delivered=MAX(messages.delivered, excluded.delivered),
         read=MAX(messages.read, excluded.read),
         edited_at=excluded.edited_at, deleted_at=excluded.deleted_at,
         decrypt_failed=CASE WHEN messages.body <> '' THEN 0 ELSE excluded.decrypt_failed END,
         -- ne jamais "dé-marquer" un vocal déjà écouté
         voice_played=MAX(messages.voice_played, excluded.voice_played),
         sync_state='synced'`,
      [
        m.id,
        m.conversation_id,
        m.sender_id,
        m.type,
        body,
        cipherToKeep,
        m.encrypted ? 1 : 0,
        m.attachment_url,
        m.attachment_meta ? JSON.stringify(m.attachment_meta) : null,
        m.reply_to ? JSON.stringify(m.reply_to) : null,
        m.reaction,
        m.delivered ? 1 : 0,
        m.read ? 1 : 0,
        m.edited_at,
        m.deleted_at,
        m.created_at,
        dfail,
        vplayed,
      ],
    );
  },

  /** Marque un vocal/vidéo reçu comme écouté / ouvert (retire le point bleu). */
  async markVoicePlayed(messageId: string): Promise<void> {
    await run('UPDATE messages SET voice_played=1 WHERE id=? OR client_id=?', [
      messageId,
      messageId,
    ]);
  },

  async setReaction(messageId: string, emoji: string | null): Promise<void> {
    await run('UPDATE messages SET reaction=? WHERE id=? OR client_id=?', [
      emoji,
      messageId,
      messageId,
    ]);
  },

  async markDeleted(messageId: string): Promise<void> {
    await run(
      'UPDATE messages SET deleted_at=?, body=\'\' WHERE id=? OR client_id=?',
      [new Date().toISOString(), messageId, messageId],
    );
  },

  async markConversationRead(conversationId: string, myId: string): Promise<void> {
    await run('UPDATE messages SET read=1 WHERE conversation_id=? AND sender_id != ?', [
      conversationId,
      myId,
    ]);
  },

  async markMineRead(conversationId: string, myId: string): Promise<void> {
    await run('UPDATE messages SET read=1 WHERE conversation_id=? AND sender_id = ?', [
      conversationId,
      myId,
    ]);
  },

  /** Un de MES messages vient d'être « remis » au partenaire (double coche). */
  async markMineDelivered(messageId: string): Promise<void> {
    await run('UPDATE messages SET delivered=1 WHERE id=? OR client_id=?', [
      messageId,
      messageId,
    ]);
  },

  /** Applique une édition de texte en local + marque `edited_at`. */
  async applyEdit(messageId: string, body: string): Promise<void> {
    await run(
      'UPDATE messages SET body=?, edited_at=? WHERE id=? OR client_id=?',
      [body, new Date().toISOString(), messageId, messageId],
    );
  },

  async listFailed(): Promise<LocalMessage[]> {
    const rows = await query<Row>('SELECT * FROM messages WHERE sync_state=\'failed\'');
    return rows.map(toMsg);
  },

  /** Messages `pending` de MOI qui n'ont PAS d'entrée d'outbox correspondante
   * (app fermée entre l'insert optimiste et l'enqueue) — à ré-empiler. */
  async listOrphanPending(myId: string, olderThanMs = 8000): Promise<LocalMessage[]> {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const rows = await query<Row>(
      `SELECT m.* FROM messages m
        WHERE m.sync_state='pending' AND m.sender_id=? AND m.created_at < ?
          AND NOT EXISTS (SELECT 1 FROM outbox o WHERE o.client_id = m.client_id)`,
      [myId, cutoff],
    );
    return rows.map(toMsg);
  },

  /**
   * Messages RECUS dont le déchiffrement a échoué mais dont on a gardé le blob
   * (`body_cipher`) — candidats à une nouvelle tentative une fois la session
   * établie. `{ id, sender_id, cipher }` bruts (pas de toMsg, on veut le blob).
   */
  async listPendingDecryption(): Promise<
    Array<{ id: string; sender_id: string; cipher: string }>
  > {
    const rows = await query<Row>(
      `SELECT id, sender_id, body_cipher FROM messages
        WHERE decrypt_failed=1 AND body='' AND body_cipher IS NOT NULL`,
    );
    return rows
      .filter((r) => r.body_cipher)
      .map((r) => ({ id: r.id, sender_id: r.sender_id, cipher: r.body_cipher as string }));
  },

  /** Applique un texte enfin déchiffré : renseigne `body`, purge le blob et
   * le flag d'échec. */
  async applyDecrypted(id: string, plain: string): Promise<void> {
    await run(
      'UPDATE messages SET body=?, body_cipher=NULL, decrypt_failed=0 WHERE id=?',
      [plain, id],
    );
  },

  /** « Effacer la discussion » — supprime tous les messages locaux. */
  async clearConversation(conversationId: string): Promise<void> {
    await run('DELETE FROM messages WHERE conversation_id=?', [conversationId]);
    await run(
      `UPDATE conversations
         SET last_message=NULL, last_message_type=NULL,
             last_message_encrypted=0, last_message_at=NULL, unread_count=0,
             updated_at=?
       WHERE id=?`,
      [new Date().toISOString(), conversationId],
    );
  },
};
