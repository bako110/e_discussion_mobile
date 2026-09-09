/**
 * Groupes & chaînes — LOCAL-FIRST (aligné sur `conversationRepo` /
 * `messageRepo`). L'app lit toujours SQLite d'abord ; le `syncEngine`
 * rafraîchit depuis le serveur quand le réseau est là, et les envois passent
 * par l'outbox (`send_group_message` / `upload_group_message`).
 */
import { query, run } from '@/db';
import type { Group, GroupKind, GroupMessage, GroupRole, MessageType, UserPublic } from '@/types';

interface GroupRow {
  id: string;
  kind: string;
  name: string;
  description: string | null;
  avatar_url: string | null;
  owner_id: string;
  invite_code: string;
  is_public: number;
  created_at: string;
  last_message_at: string | null;
  last_message_preview: string | null;
  member_count: number;
  unread_count: number;
  my_role: string | null;
  can_post: number;
  muted: number;
  sync_state: string;
  updated_at: string;
}

interface GMsgRow {
  id: string;
  client_id: string | null;
  group_id: string;
  sender_id: string;
  sender_json: string | null;
  type: string;
  body: string;
  attachment_url: string | null;
  attachment_meta: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  sync_state: string;
}

export interface LocalGroup extends Group {
  muted: boolean;
  sync_state: 'synced' | 'pending';
}

export interface LocalGroupMessage extends GroupMessage {
  sync_state: 'synced' | 'pending' | 'failed';
}

function toGroup(r: GroupRow): LocalGroup {
  return {
    id: r.id,
    kind: r.kind as GroupKind,
    name: r.name,
    description: r.description,
    avatar_url: r.avatar_url,
    owner_id: r.owner_id,
    invite_code: r.invite_code,
    is_public: !!r.is_public,
    created_at: r.created_at,
    last_message_at: r.last_message_at,
    last_message_preview: r.last_message_preview,
    member_count: r.member_count,
    unread_count: r.unread_count,
    my_role: (r.my_role as GroupRole | null) ?? null,
    can_post: !!r.can_post,
    muted: !!r.muted,
    sync_state: r.sync_state as 'synced' | 'pending',
  };
}

function toGMsg(r: GMsgRow): LocalGroupMessage {
  return {
    id: r.id,
    group_id: r.group_id,
    sender_id: r.sender_id,
    sender: r.sender_json ? (JSON.parse(r.sender_json) as UserPublic) : null,
    client_id: r.client_id,
    type: r.type as GroupMessage['type'],
    body: r.body,
    attachment_url: r.attachment_url,
    attachment_meta: r.attachment_meta
      ? (JSON.parse(r.attachment_meta) as Record<string, unknown>)
      : null,
    edited_at: r.edited_at,
    deleted_at: r.deleted_at,
    created_at: r.created_at,
    pending: r.sync_state !== 'synced',
    sync_state: r.sync_state as 'synced' | 'pending' | 'failed',
  };
}

export const groupRepo = {
  // ── Groupes ────────────────────────────────────────────────────────────
  async list(): Promise<LocalGroup[]> {
    const rows = await query<GroupRow>(
      'SELECT * FROM groups ORDER BY COALESCE(last_message_at, updated_at) DESC',
    );
    return rows.map(toGroup);
  },

  async get(id: string): Promise<LocalGroup | null> {
    const rows = await query<GroupRow>('SELECT * FROM groups WHERE id=?', [id]);
    return rows[0] ? toGroup(rows[0]) : null;
  },

  /** Upsert depuis le serveur. Ne touche pas `muted`/`unread_count` si la ligne
   * locale est `pending` (changement pas encore poussé). */
  async upsertFromServer(g: Group): Promise<void> {
    const P = "groups.sync_state='pending'";
    await run(
      `INSERT INTO groups
        (id, kind, name, description, avatar_url, owner_id, invite_code, is_public,
         created_at, last_message_at, last_message_preview, member_count, unread_count,
         my_role, can_post, muted, sync_state, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,'synced',?)
       ON CONFLICT(id) DO UPDATE SET
         kind=excluded.kind, name=excluded.name, description=excluded.description,
         avatar_url=excluded.avatar_url, owner_id=excluded.owner_id,
         invite_code=excluded.invite_code, is_public=excluded.is_public,
         last_message_at=COALESCE(excluded.last_message_at, groups.last_message_at),
         last_message_preview=CASE
           WHEN COALESCE(excluded.last_message_preview,'') <> '' THEN excluded.last_message_preview
           ELSE groups.last_message_preview END,
         member_count=excluded.member_count,
         unread_count=CASE WHEN ${P} THEN groups.unread_count ELSE excluded.unread_count END,
         my_role=excluded.my_role, can_post=excluded.can_post,
         sync_state=CASE WHEN ${P} THEN 'pending' ELSE 'synced' END,
         updated_at=excluded.updated_at`,
      [
        g.id,
        g.kind,
        g.name,
        g.description,
        g.avatar_url,
        g.owner_id,
        g.invite_code,
        g.is_public ? 1 : 0,
        g.created_at,
        g.last_message_at,
        g.last_message_preview,
        g.member_count,
        g.unread_count,
        g.my_role,
        g.can_post ? 1 : 0,
        new Date().toISOString(),
      ],
    );
  },

  async bulkReplace(list: Group[]): Promise<void> {
    for (const g of list) await groupRepo.upsertFromServer(g);
    // purge les groupes que le serveur ne renvoie plus (quitté ailleurs)
    if (list.length) {
      const ids = list.map((g) => `'${g.id}'`).join(',');
      await run(`DELETE FROM groups WHERE id NOT IN (${ids})`);
    }
  },

  async setUnread(id: string, count: number): Promise<void> {
    await run('UPDATE groups SET unread_count=? WHERE id=?', [count, id]);
  },

  async setMuted(id: string, muted: boolean): Promise<void> {
    await run("UPDATE groups SET muted=?, sync_state='pending' WHERE id=?", [muted ? 1 : 0, id]);
  },

  async markSynced(id: string): Promise<void> {
    await run("UPDATE groups SET sync_state='synced' WHERE id=?", [id]);
  },

  async touchLastMessage(
    id: string,
    preview: string,
    at: string,
  ): Promise<void> {
    await run(
      `UPDATE groups
         SET last_message_preview = CASE WHEN ? <> '' THEN ? ELSE last_message_preview END,
             last_message_at=?, updated_at=?
       WHERE id=?`,
      [preview, preview, at, new Date().toISOString(), id],
    );
  },

  // ── Messages ───────────────────────────────────────────────────────────
  async page(groupId: string, limit = 40, beforeCreatedAt?: string): Promise<LocalGroupMessage[]> {
    const rows = beforeCreatedAt
      ? await query<GMsgRow>(
          `SELECT * FROM group_messages WHERE group_id=? AND created_at < ?
             ORDER BY created_at DESC LIMIT ?`,
          [groupId, beforeCreatedAt, limit],
        )
      : await query<GMsgRow>(
          'SELECT * FROM group_messages WHERE group_id=? ORDER BY created_at DESC LIMIT ?',
          [groupId, limit],
        );
    // renvoyé du plus ancien au plus récent (l'écran groupe n'est pas inversé)
    return rows.map(toGMsg).reverse();
  },

  async getByClientId(clientId: string): Promise<LocalGroupMessage | null> {
    const rows = await query<GMsgRow>('SELECT * FROM group_messages WHERE client_id=?', [clientId]);
    return rows[0] ? toGMsg(rows[0]) : null;
  },

  /** Groupes qui ont déjà de l'historique local (= déjà ouverts au moins une fois). */
  async groupIdsWithMessages(): Promise<Set<string>> {
    const rows = await query<{ group_id: string }>(
      'SELECT DISTINCT group_id FROM group_messages',
    );
    return new Set(rows.map((r) => r.group_id));
  },

  async insertOutgoing(m: {
    clientId: string;
    groupId: string;
    senderId: string;
    type: MessageType | 'system';
    body: string;
    attachmentUrl?: string | null;
    attachmentMeta?: Record<string, unknown> | null;
    createdAt: string;
  }): Promise<void> {
    try {
      await run(
        `INSERT INTO group_messages
          (id, client_id, group_id, sender_id, type, body, attachment_url, attachment_meta,
           created_at, sync_state)
         VALUES (?,?,?,?,?,?,?,?,?, 'pending')`,
        [
          m.clientId,
          m.clientId,
          m.groupId,
          m.senderId,
          m.type,
          m.body,
          m.attachmentUrl ?? null,
          m.attachmentMeta ? JSON.stringify(m.attachmentMeta) : null,
          m.createdAt,
        ],
      );
    } catch (e) {
      const msg = String(e);
      if (msg.includes('UNIQUE') || msg.includes('constraint')) return;
      throw e;
    }
  },

  /** Upsert d'un message venu du serveur (WS ou pull). Recolle une ligne
   * `pending` locale via `client_id`. */
  async upsertMessageFromServer(m: GroupMessage): Promise<void> {
    if (m.client_id) {
      await run(
        "UPDATE group_messages SET id=?, sync_state='synced' WHERE client_id=? AND id<>?",
        [m.id, m.client_id, m.id],
      );
    }
    await run(
      `INSERT INTO group_messages
        (id, client_id, group_id, sender_id, sender_json, type, body, attachment_url,
         attachment_meta, edited_at, deleted_at, created_at, sync_state)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'synced')
       ON CONFLICT(id) DO UPDATE SET
         sender_json=COALESCE(excluded.sender_json, group_messages.sender_json),
         body=excluded.body,
         attachment_url=COALESCE(excluded.attachment_url, group_messages.attachment_url),
         attachment_meta=COALESCE(excluded.attachment_meta, group_messages.attachment_meta),
         edited_at=excluded.edited_at, deleted_at=excluded.deleted_at,
         sync_state='synced'`,
      [
        m.id,
        m.client_id,
        m.group_id,
        m.sender_id,
        m.sender ? JSON.stringify(m.sender) : null,
        m.type,
        m.body,
        m.attachment_url,
        m.attachment_meta ? JSON.stringify(m.attachment_meta) : null,
        m.edited_at,
        m.deleted_at,
        m.created_at,
      ],
    );
  },

  async confirmSent(clientId: string, server: GroupMessage): Promise<void> {
    await run(
      `UPDATE group_messages
         SET id=?, body=?, created_at=?, sender_json=COALESCE(?, sender_json),
             attachment_url=COALESCE(?, attachment_url),
             attachment_meta=COALESCE(?, attachment_meta),
             sync_state='synced'
       WHERE client_id=?`,
      [
        server.id,
        server.body,
        server.created_at,
        server.sender ? JSON.stringify(server.sender) : null,
        server.attachment_url ?? null,
        server.attachment_meta ? JSON.stringify(server.attachment_meta) : null,
        clientId,
      ],
    );
  },

  async setAttachment(
    clientId: string,
    url: string,
    meta: Record<string, unknown> | null,
  ): Promise<void> {
    await run('UPDATE group_messages SET attachment_url=?, attachment_meta=? WHERE client_id=?', [
      url,
      meta ? JSON.stringify(meta) : null,
      clientId,
    ]);
  },

  async markFailed(clientId: string): Promise<void> {
    await run("UPDATE group_messages SET sync_state='failed' WHERE client_id=?", [clientId]);
  },

  async markDeleted(id: string): Promise<void> {
    await run(
      "UPDATE group_messages SET deleted_at=?, body='' WHERE id=? OR client_id=?",
      [new Date().toISOString(), id, id],
    );
  },

  /** « Effacer » local (quitter le groupe / vider). */
  async clearGroup(groupId: string): Promise<void> {
    await run('DELETE FROM group_messages WHERE group_id=?', [groupId]);
  },

  async removeGroup(groupId: string): Promise<void> {
    await run('DELETE FROM group_messages WHERE group_id=?', [groupId]);
    await run('DELETE FROM groups WHERE id=?', [groupId]);
  },
};
