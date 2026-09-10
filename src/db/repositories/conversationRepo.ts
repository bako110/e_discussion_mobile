import { query, run } from '@/db';
import type { ConversationSummary, MessageType, RequestStatus, UserPublic } from '@/types';

interface Row {
  id: string;
  partner_id: string;
  partner_json: string;
  last_message: string | null;
  last_message_type: string | null;
  last_message_at: string | null;
  last_message_encrypted: number;
  unread_count: number;
  muted: number;
  request_status: string;
  sync_state: string;
  updated_at: string;
}

function toSummary(r: Row): ConversationSummary {
  return {
    id: r.id,
    partner: JSON.parse(r.partner_json) as UserPublic,
    last_message: r.last_message,
    last_message_type: r.last_message_type as MessageType | null,
    last_message_at: r.last_message_at,
    last_message_encrypted: !!r.last_message_encrypted,
    unread_count: r.unread_count,
    muted: !!r.muted,
    request_status: r.request_status as RequestStatus,
  };
}

export const conversationRepo = {
  async list(): Promise<ConversationSummary[]> {
    const rows = await query<Row>(
      'SELECT * FROM conversations ORDER BY COALESCE(last_message_at, updated_at) DESC',
    );
    return rows.map(toSummary);
  },

  async get(id: string): Promise<ConversationSummary | null> {
    const rows = await query<Row>('SELECT * FROM conversations WHERE id = ?', [id]);
    return rows[0] ? toSummary(rows[0]) : null;
  },

  /**
   * Upsert depuis le serveur (sync). On rafraichit toujours les infos du
   * partenaire / dernier message, MAIS on ne touche pas `request_status`,
   * `muted` ni `unread_count` si la ligne locale est encore `pending` : ce
   * sont des changements que l'utilisateur a faits et qui ne sont pas encore
   * partis dans l'outbox — le serveur renverrait l'ancienne valeur.
   */
  async upsertFromServer(c: ConversationSummary): Promise<void> {
    const P = "conversations.sync_state='pending'"; // ligne modifiee localement, non poussee
    await run(
      `INSERT INTO conversations
        (id, partner_id, partner_json, last_message, last_message_type, last_message_at,
         last_message_encrypted, unread_count, muted, request_status, sync_state, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?, 'synced', ?)
       ON CONFLICT(id) DO UPDATE SET
         partner_json=excluded.partner_json,
         -- ne pas ecraser un apercu clair local par un vide venu du serveur
         -- (le serveur ne peut pas dechiffrer -> last_message vide pour E2E)
         last_message=CASE
           WHEN COALESCE(excluded.last_message,'') <> '' THEN excluded.last_message
           ELSE conversations.last_message END,
         last_message_type=COALESCE(excluded.last_message_type, conversations.last_message_type),
         last_message_at=COALESCE(excluded.last_message_at, conversations.last_message_at),
         last_message_encrypted=excluded.last_message_encrypted,
         unread_count=CASE WHEN ${P} THEN conversations.unread_count ELSE excluded.unread_count END,
         muted=CASE WHEN ${P} THEN conversations.muted ELSE excluded.muted END,
         request_status=CASE WHEN ${P} THEN conversations.request_status ELSE excluded.request_status END,
         sync_state=CASE WHEN ${P} THEN 'pending' ELSE 'synced' END,
         updated_at=excluded.updated_at`,
      [
        c.id,
        c.partner.id,
        JSON.stringify(c.partner),
        c.last_message,
        c.last_message_type,
        c.last_message_at,
        c.last_message_encrypted ? 1 : 0,
        c.unread_count,
        c.muted ? 1 : 0,
        c.request_status,
        new Date().toISOString(),
      ],
    );
  },

  async bulkReplace(list: ConversationSummary[]): Promise<void> {
    for (const c of list) await conversationRepo.upsertFromServer(c);
  },

  /** MàJ optimiste locale du dernier message + réordonnancement.
   *
   * `text` est TOUJOURS le texte CLAIR (déjà déchiffré par l'appelant), ou
   * '' / null si le déchiffrement a échoué. `encrypted` n'est qu'un indice
   * sur le transport : il sert au fallback "cadenas" quand `text` est vide.
   * On ne remplace PAS un aperçu clair existant par un vide. */
  async touchLastMessage(
    id: string,
    text: string | null,
    type: MessageType,
    encrypted: boolean,
    at: string,
  ): Promise<void> {
    const clean = (text ?? '').trim();
    await run(
      `UPDATE conversations
         SET last_message = CASE WHEN ? <> '' THEN ? ELSE last_message END,
             last_message_type=?,
             last_message_encrypted=?,
             last_message_at=?,
             updated_at=?
       WHERE id=?`,
      [clean, clean, type, encrypted ? 1 : 0, at, new Date().toISOString(), id],
    );
  },

  async setUnread(id: string, count: number): Promise<void> {
    await run('UPDATE conversations SET unread_count=? WHERE id=?', [count, id]);
  },

  /**
   * Recale `unread_count` sur le VRAI nombre de messages reçus non lus en base.
   * Idempotent : peut être appelé plusieurs fois pour le même message entrant
   * (l'event `message.new` peut être livré par plusieurs canaux) sans gonfler
   * le compteur, contrairement à un simple `+1`.
   */
  async recountUnread(id: string, myId: string): Promise<void> {
    await run(
      `UPDATE conversations SET unread_count = (
         SELECT COUNT(*) FROM messages
         WHERE conversation_id = ?1
           AND sender_id <> ?2
           AND read = 0
           AND deleted_at IS NULL
       ) WHERE id = ?1`,
      [id, myId],
    );
  },

  async setRequestStatus(id: string, status: RequestStatus): Promise<void> {
    await run('UPDATE conversations SET request_status=?, sync_state=\'pending\' WHERE id=?', [
      status,
      id,
    ]);
  },

  async setMuted(id: string, muted: boolean): Promise<void> {
    await run("UPDATE conversations SET muted=?, sync_state='pending' WHERE id=?", [
      muted ? 1 : 0,
      id,
    ]);
  },

  /** Le changement local a bien ete pousse au serveur : on retire le flag. */
  async markSynced(id: string): Promise<void> {
    await run("UPDATE conversations SET sync_state='synced' WHERE id=?", [id]);
  },
};
