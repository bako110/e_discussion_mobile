/**
 * File d'attente des mutations effectuées hors-ligne (ou en ligne — tout
 * passe par ici pour une sémantique unique). Chaque entrée est rejouée dans
 * l'ordre par `syncEngine`. `client_id` garantit l'idempotence côté serveur.
 */
import { query, run } from '@/db';
import { uuidv4 } from '@/utils/random';

export type OutboxKind =
  | 'send_message'
  | 'upload_message' // média choisi hors-ligne : upload différé + envoi
  | 'react'
  | 'edit'
  | 'delete'
  | 'mark_read'
  | 'accept_request'
  | 'decline_request'
  | 'mute'
  | 'update_me' // réglages users.* (confidentialité, appels, langue, profil)
  | 'update_story_audience' // confidentialité des statuts (mode + liste de contacts)
  | 'update_privacy_field' // confidentialité profil : un champ (mode + liste)
  | 'create_story' // statut texte (aucun média à uploader)
  | 'upload_story' // statut photo/vidéo/audio : upload différé + publication
  // ── groupes ──
  | 'send_group_message'
  | 'upload_group_message'
  | 'group_mark_read'
  | 'group_mute'
  | 'group_update' // nom / description / avatar / is_public
  | 'group_member_role'
  | 'group_member_remove'
  | 'group_leave'
  | 'group_delete';

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

/**
 * Déclencheur appelé APRÈS chaque `enqueue` — branché par le syncEngine sur
 * `pushNow()` pour que toute mutation parte immédiatement (au lieu d'attendre
 * le prochain cycle de sync). Découplé pour éviter l'import circulaire.
 */
let onEnqueued: (() => void) | null = null;
export function setOnEnqueued(fn: (() => void) | null): void {
  onEnqueued = fn;
}

/**
 * Déclencheur appelé quand une entrée `send_message` / `upload_message` /
 * `send_group_message` a été confirmée par le serveur (`confirmSent`) — sert
 * à rafraîchir l'écran ouvert (la bulle passe de ⏱ à ✓). Branché sur
 * `emitLocal` de MessageSync.
 */
let onMutationApplied:
  | ((info: { conversationId?: string; groupId?: string }) => void)
  | null = null;
export function setOnMutationApplied(
  fn: ((info: { conversationId?: string; groupId?: string }) => void) | null,
): void {
  onMutationApplied = fn;
}
export function notifyMutationApplied(info: { conversationId?: string; groupId?: string }): void {
  try {
    onMutationApplied?.(info);
  } catch {
    /* un abonné ne casse rien */
  }
}

export const outbox = {
  async enqueue(kind: OutboxKind, clientId: string, payload: Record<string, unknown>): Promise<void> {
    const now = new Date().toISOString();
    await run(
      `INSERT INTO outbox (kind, client_id, payload_json, attempts, created_at, next_try_at)
       VALUES (?,?,?,0,?,?)`,
      [kind, clientId, JSON.stringify(payload), now, now],
    );
    // pousse tout de suite (best-effort, non bloquant)
    try {
      onEnqueued?.();
    } catch {
      /* le cycle de sync rattrapera */
    }
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
