/**
 * Historique local des notifications (messages reçus + appels).
 *
 * Alimenté par `notificationService` à chaque notif OS affichée, et par
 * `CallContext` pour les appels manqués même quand l'app est au premier plan
 * (aucune notif OS dans ce cas, mais l'entrée d'historique doit exister).
 *
 * 100 % local : consultable hors-ligne, purgé au-delà de MAX_ROWS.
 */
import { query, run } from '@/db';

const MAX_ROWS = 300;

export type NotifKind = 'message' | 'call';
export type CallResult = 'missed' | 'incoming' | 'outgoing' | 'rejected';

export interface LocalNotification {
  id: string;
  kind: NotifKind;
  title: string;
  body: string;
  conversationId: string | null;
  groupId: string | null;
  callId: string | null;
  peerId: string | null;
  avatarUrl: string | null;
  callResult: CallResult | null;
  callType: 'voice' | 'video' | null;
  read: boolean;
  createdAt: string;
}

interface Row {
  id: string;
  kind: string;
  title: string;
  body: string;
  conversation_id: string | null;
  group_id: string | null;
  call_id: string | null;
  peer_id: string | null;
  avatar_url: string | null;
  call_result: string | null;
  call_type: string | null;
  read: number;
  created_at: string;
}

function toNotif(r: Row): LocalNotification {
  return {
    id: r.id,
    kind: r.kind as NotifKind,
    title: r.title,
    body: r.body,
    conversationId: r.conversation_id,
    groupId: r.group_id,
    callId: r.call_id,
    peerId: r.peer_id,
    avatarUrl: r.avatar_url,
    callResult: (r.call_result as CallResult | null) ?? null,
    callType: (r.call_type as 'voice' | 'video' | null) ?? null,
    read: !!r.read,
    createdAt: r.created_at,
  };
}

export interface NewNotification {
  id: string;
  kind: NotifKind;
  title: string;
  body?: string;
  conversationId?: string | null;
  groupId?: string | null;
  callId?: string | null;
  peerId?: string | null;
  avatarUrl?: string | null;
  callResult?: CallResult | null;
  callType?: 'voice' | 'video' | null;
  createdAt?: string;
}

const listeners = new Set<() => void>();
function emit(): void {
  listeners.forEach((fn) => {
    try {
      fn();
    } catch {
      /* noop */
    }
  });
}

export const notificationRepo = {
  /** S'abonne aux changements (insert / read / clear). */
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  /** Ajoute une entrée. `id` stable -> ré-insertion = mise à jour (upsert). */
  async add(n: NewNotification): Promise<void> {
    const createdAt = n.createdAt ?? new Date().toISOString();
    await run(
      `INSERT INTO notifications
         (id, kind, title, body, conversation_id, group_id, call_id, peer_id,
          avatar_url, call_result, call_type, read, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
       ON CONFLICT(id) DO UPDATE SET
         title = excluded.title,
         body = excluded.body,
         call_result = excluded.call_result,
         read = 0,
         created_at = excluded.created_at`,
      [
        n.id,
        n.kind,
        n.title,
        n.body ?? '',
        n.conversationId ?? null,
        n.groupId ?? null,
        n.callId ?? null,
        n.peerId ?? null,
        n.avatarUrl ?? null,
        n.callResult ?? null,
        n.callType ?? null,
        createdAt,
      ],
    );
    // purge best-effort au-delà du plafond
    await run(
      `DELETE FROM notifications WHERE id IN (
         SELECT id FROM notifications ORDER BY created_at DESC LIMIT -1 OFFSET ?
       )`,
      [MAX_ROWS],
    ).catch(() => undefined);
    emit();
  },

  async list(limit = 200): Promise<LocalNotification[]> {
    const rows = await query<Row>(
      'SELECT * FROM notifications ORDER BY created_at DESC LIMIT ?',
      [limit],
    );
    return rows.map(toNotif);
  },

  async unreadCount(): Promise<number> {
    const rows = await query<{ n: number }>(
      'SELECT COUNT(*) AS n FROM notifications WHERE read = 0',
    );
    return rows[0]?.n ?? 0;
  },

  async markAllRead(): Promise<void> {
    await run('UPDATE notifications SET read = 1 WHERE read = 0');
    emit();
  },

  async markRead(id: string): Promise<void> {
    await run('UPDATE notifications SET read = 1 WHERE id = ?', [id]);
    emit();
  },

  /** Marque lues toutes les notifs d'une conversation (chat ouvert). */
  async markConversationRead(conversationId: string): Promise<void> {
    await run(
      'UPDATE notifications SET read = 1 WHERE conversation_id = ? AND read = 0',
      [conversationId],
    );
    emit();
  },

  async clearAll(): Promise<void> {
    await run('DELETE FROM notifications');
    emit();
  },

  async remove(id: string): Promise<void> {
    await run('DELETE FROM notifications WHERE id = ?', [id]);
    emit();
  },
};
