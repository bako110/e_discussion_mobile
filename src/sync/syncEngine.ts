/**
 * Moteur de synchronisation offline-first.
 *
 *  pushOutbox()  — rejoue les mutations locales en attente vers le serveur,
 *                  dans l'ordre, avec idempotence (client_id) et backoff.
 *  pullDeltas()  — récupère les conversations + les messages modifiés depuis
 *                  le dernier `lastSyncAt` et les fusionne en local.
 *  syncNow()     — pushOutbox() puis pullDeltas(). Déclenché : au démarrage,
 *                  au retour du réseau (NetInfo), à l'ouverture de l'app,
 *                  et manuellement (pull-to-refresh).
 *
 * Tout est best-effort : hors-ligne, syncNow() ne fait rien et l'app
 * continue de fonctionner sur la base locale.
 */
import { apiClient, ApiError, Endpoints } from '@/api';
import { query, run } from '@/db';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import { messageRepo } from '@/db/repositories/messageRepo';
import { messageService as netMessages } from '@/services/messageService.net';
import type { ChatMessage, ConversationSummary } from '@/types';

import { outbox, type OutboxEntry } from './outbox';

const LAST_SYNC_KEY = 'last_sync_at';

// id de l'utilisateur courant — pose par AuthContext, sert a distinguer NOS
// messages (garder le texte clair local) de ceux recus (dechiffrer).
let currentUserId: string | null = null;
export function setSyncUser(id: string | null): void {
  currentUserId = id;
}

let running = false;
let lastRunAt = 0;
const MIN_INTERVAL_MS = 4000; // coalesce les declencheurs rapproches (mount + AppState + NetInfo)
type Progress = (state: { phase: 'push' | 'pull' | 'idle'; pending: number }) => void;
const listeners = new Set<Progress>();

export function onSyncProgress(fn: Progress): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit(phase: 'push' | 'pull' | 'idle', pending: number): void {
  listeners.forEach((fn) => fn({ phase, pending }));
}

async function getMeta(key: string): Promise<string | null> {
  const rows = await query<{ value: string }>('SELECT value FROM meta WHERE key=?', [key]);
  return rows[0]?.value ?? null;
}
async function setMeta(key: string, value: string): Promise<void> {
  await run('INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [
    key,
    value,
  ]);
}

// ── PUSH ──────────────────────────────────────────────────────────────────
async function applyEntry(entry: OutboxEntry): Promise<void> {
  const p = entry.payload;
  switch (entry.kind) {
    case 'send_message': {
      const saved = await apiClient.post<ChatMessage>(
        Endpoints.conversations.messages(p.conversationId as string),
        {
          type: p.type ?? 'text',
          body: p.body ?? '',
          encrypted: p.encrypted ?? false,
          attachment_url: p.attachmentUrl ?? undefined,
          attachment_meta: p.attachmentMeta ?? undefined,
          reply_to_id: p.replyToId ?? undefined,
          client_id: entry.client_id,
        },
      );
      const plain = (p.plainBody as string | undefined) ?? saved.body;
      await messageRepo.confirmSent(entry.client_id, { ...saved, body: plain });
      await conversationRepo.touchLastMessage(
        p.conversationId as string,
        plain,
        saved.type,
        saved.encrypted,
        saved.created_at,
      );
      break;
    }
    case 'react':
      await apiClient.post(Endpoints.messages.react(p.messageId as string), { emoji: p.emoji ?? null });
      break;
    case 'edit':
      await apiClient.patch(Endpoints.messages.byId(p.messageId as string), { body: p.body });
      break;
    case 'delete':
      await apiClient.delete(Endpoints.messages.byId(p.messageId as string));
      break;
    case 'mark_read':
      await apiClient.put(Endpoints.conversations.read(p.conversationId as string));
      break;
    case 'accept_request':
      await apiClient.post(Endpoints.conversations.accept(p.conversationId as string));
      await conversationRepo.markSynced(p.conversationId as string);
      break;
    case 'decline_request':
      await apiClient.post(Endpoints.conversations.decline(p.conversationId as string));
      await conversationRepo.markSynced(p.conversationId as string);
      break;
    case 'mute':
      await (p.muted
        ? apiClient.post(Endpoints.conversations.mute(p.conversationId as string))
        : apiClient.delete(Endpoints.conversations.mute(p.conversationId as string)));
      await conversationRepo.markSynced(p.conversationId as string);
      break;
  }
}

export async function pushOutbox(): Promise<void> {
  const entries = await outbox.due();
  if (entries.length) console.log(`[sync] push: ${entries.length} entree(s) a envoyer`);
  for (const entry of entries) {
    emit('push', await outbox.count());
    try {
      await applyEntry(entry);
      await outbox.remove(entry.id);
      console.log(`[sync] push OK: ${entry.kind} (${entry.client_id.slice(0, 8)})`);
    } catch (err) {
      const isClient = err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429;
      const status = err instanceof ApiError ? err.status : '?';
      console.warn(`[sync] push ECHEC ${entry.kind}: status=${status} ${(err as Error).message}`);
      if (isClient) {
        // Erreur définitive (validation, conflit non idempotent, droit) :
        // on abandonne l'entrée et on marque la ligne locale en échec.
        await outbox.remove(entry.id);
        if (entry.kind === 'send_message') await messageRepo.markFailed(entry.client_id);
      } else {
        const outcome = await outbox.retryLater(entry, (err as Error).message);
        if (outcome === 'gaveup' && entry.kind === 'send_message') {
          await messageRepo.markFailed(entry.client_id);
          await outbox.remove(entry.id);
        }
        // erreur réseau/serveur : on arrête la boucle, on reprendra au prochain syncNow
        break;
      }
    }
  }
}

// ── PULL ──────────────────────────────────────────────────────────────────
export async function pullDeltas(): Promise<void> {
  emit('pull', await outbox.count());
  const convs = await apiClient.get<ConversationSummary[]>(Endpoints.conversations.list);
  // Ne pas écraser une conversation dont l'utilisateur a modifié le statut
  // localement mais qui n'a pas encore été poussée.
  await conversationRepo.bulkReplace(convs);

  const since = await getMeta(LAST_SYNC_KEY);
  const nowIso = new Date().toISOString();

  // Delta des messages, conversation par conversation (seulement celles qu'on
  // connaît déjà — l'ouverture d'un chat charge de toute façon sa page).
  for (const c of convs) {
    const raw = since
      ? await netMessages.since(c.id, since)
      : await netMessages.history(c.id, 1, 40);
    for (const m of raw) {
      const mine = !!currentUserId && m.sender_id === currentUserId;
      if (mine) {
        // NOS messages : le blob chiffre est indéchiffrable pour nous. On
        // recolle la ligne locale via client_id et on garde son texte clair.
        const local = m.client_id
          ? await messageRepo.getByClientId(m.client_id)
          : await messageRepo.getById(m.id);
        await messageRepo.upsertFromServer(m, {
          mine: true,
          clientId: m.client_id ?? null,
          plainBody: local?.body ?? (m.encrypted ? '' : m.body),
        });
      } else {
        const decrypted = await netMessages.decryptIfNeeded(m);
        await messageRepo.upsertFromServer(decrypted, {
          clientId: m.client_id ?? null,
          decryptFailed: !!decrypted.decryptFailed,
          cipherBody: decrypted.decryptFailed && m.encrypted ? m.body : null,
        });
        // accuse « remis » pour les messages rattrapes hors-ligne
        if (!m.delivered) void netMessages.ackDelivered(m.id);
      }
    }
  }

  // Nouvelle passe : re-tente le déchiffrement des messages restés chiffrés
  // (session enfin établie, prekey récupérée...).
  await retryFailedDecryptions();

  await setMeta(LAST_SYNC_KEY, nowIso);
}

/**
 * Repasse sur les messages reçus dont le déchiffrement avait échoué et dont on
 * a conservé le blob (`body_cipher`). Une fois la session Double Ratchet établie
 * avec l'expéditeur, ces messages redeviennent déchiffrables — c'est ce qui
 * corrige l'affichage « tout chiffré » après une reconnexion.
 */
export async function retryFailedDecryptions(): Promise<number> {
  const pending = await messageRepo.listPendingDecryption();
  if (pending.length === 0) return 0;
  let recovered = 0;
  for (const p of pending) {
    const plain = await netMessages.tryDecryptCipher(p.sender_id, p.cipher);
    if (plain != null) {
      await messageRepo.applyDecrypted(p.id, plain);
      recovered++;
    }
  }
  if (recovered > 0) {
    console.log(`[sync] ${recovered} message(s) enfin déchiffré(s)`);
  }
  return recovered;
}

// ── ORCHESTRATION ─────────────────────────────────────────────────────────
export async function syncNow(opts?: { force?: boolean }): Promise<void> {
  if (running) return;
  if (!opts?.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return;
  running = true;
  lastRunAt = Date.now();
  try {
    await pushOutbox();
    await pullDeltas();
  } catch (e) {
    // hors-ligne ou serveur indisponible — on réessaiera
    console.warn('[sync] syncNow interrompu:', (e as Error).message);
  } finally {
    running = false;
    lastRunAt = Date.now();
    emit('idle', await outbox.count());
  }
}

export async function resetSyncCursor(): Promise<void> {
  await run('DELETE FROM meta WHERE key=?', [LAST_SYNC_KEY]);
}
