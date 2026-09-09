/**
 * File d'attente des mutations effectuées hors-ligne (ou en ligne — tout
 * passe par ici pour une sémantique unique). Chaque entrée est rejouée dans
 * l'ordre par `syncEngine`. `client_id` garantit l'idempotence côté serveur.
 */
import { query, run } from '@/db';
import { uuidv4 } from '@/utils/random';

export type OutboxKind =
  | 'send_message'
  | 'react'
  | 'edit'
  | 'delete'
  | 'mark_read'
  | 'accept_request'
  | 'decline_request'
  | 'mute';

export interface OutboxEntry {
  id: number;
  kind: OutboxKind;
  client_id: string;
  payload: Record<string, unknown>;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_try_at: string;
}

interface Row {
  id: number;
  kind: string;
  client_id: string;
  payload_json: string;
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_try_at: string;
}

const MAX_ATTEMPTS = 8;

export function newClientId(): string {
  return uuidv4();
}

export const outbox = {
  async enqueue(kind: OutboxKind, clientId: string, payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO outbox (kind, client_id, payload_json, attempts, created_at, next_try_at)
       VALUES (?,?,?,0,?,?)`,
      [kind, clientId, JSON.stringify(payload), now, now],
    );
  },

  async due(): Promise<OutboxEntry[]> {
    const nowIso = new Date().toISOString();
    const rows = await query<Row>(
      'SELECT * FROM outbox WHERE next_try_at <= ? ORDER BY id ASC',
      [nowIso],
    );
    return rows.map((r) => ({
      id: r.id,
      kind: r.kind as OutboxKind,
      client_id: r.client_id,
      payload: JSON.parse(r.payload_json) as Record<string, unknown>,
      attempts: r.attempts,
      last_error: r.last_error,
      created_at: r.created_at,
      next_try_at: r.next_try_at,
    }));
  },

  async count(): Promise<number> {
    const rows = await query<{ n: number }>('SELECT COUNT(*) AS n FROM outbox');
    return rows[0]?.n ?? 0;
  },

  async remove(id: number): Promise<void> {
    await run('DELETE FROM outbox WHERE id=?', [id]);
  },

  /** Échec transitoire : on planifie une nouvelle tentative (backoff exp.). */
  async retryLater(entry: OutboxEntry, error: string): Promise<'retry' | 'gaveup'> {
    const attempts = entry.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await run('UPDATE outbox SET attempts=?, last_error=? WHERE id=?', [attempts, error, entry.id]);
      return 'gaveup';
    }
    const delayMs = Math.min(5 * 60_000, 2 ** attempts * 1000);
    const next = new Date(Date.now() + delayMs).toISOString();
    await run('UPDATE outbox SET attempts=?, last_error=?, next_try_at=? WHERE id=?', [
      attempts,
      error,
      next,
      entry.id,
    ]);
    return 'retry';
  },
};
