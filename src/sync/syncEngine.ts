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
import { apiClient, ApiError, Endpoints, type UploadFile } from '@/api';
import { query, run } from '@/db';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import { messageRepo } from '@/db/repositories/messageRepo';
import { groupRepo } from '@/db/repositories/groupRepo';
import { messageService as netMessages } from '@/services/messageService.net';
import { mediaService } from '@/services/mediaService';
import { mediaCache } from '@/services/mediaCache';
import type { ChatMessage, ConversationSummary, Group, GroupMessage } from '@/types';

import { notifyMutationApplied, outbox, setOnEnqueued, type OutboxEntry } from './outbox';

const LAST_SYNC_KEY = 'last_sync_at';

/** Aperçu court d'une conversation quand le dernier message est une pièce jointe sans texte. */
const ATTACH_PREVIEW: Record<string, string> = {
  image: 'Photo',
  video: 'Vidéo',
  voice: 'Message vocal',
  file: 'Document',
  location: 'Position',
};

// id de l'utilisateur courant — pose par AuthContext, sert a distinguer NOS
// messages (garder le texte clair local) de ceux recus (dechiffrer).
let currentUserId: string | null = null;
export function setSyncUser(id: string | null): void {
  currentUserId = id;
}

let running = false;
let lastRunAt = 0;
const MIN_INTERVAL_MS = 4000; // coalesce les declencheurs rapproches (mount + AppState + NetInfo)

// Verrou DÉDIÉ au push : indépendant du gros `pullDeltas`, pour que l'envoi
// d'un message parte immédiatement même si un pull est en cours.
let pushing = false;
let pushAgain = false;
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
      const preview = plain || ATTACH_PREVIEW[saved.type] || '';
      await conversationRepo.touchLastMessage(
        p.conversationId as string,
        preview,
        saved.type,
        saved.encrypted,
        saved.created_at,
      );
      notifyMutationApplied({ conversationId: p.conversationId as string });
      break;
    }

    // ── média choisi hors-ligne : on uploade MAINTENANT (réseau revenu) puis
    //    on envoie le message. Idempotent : si l'upload a déjà réussi lors
    //    d'une tentative précédente, l'URL est mémorisée dans le payload.
    case 'upload_message': {
      const localFile = p.localFile as UploadFile | undefined;
      let attachmentUrl = p.attachmentUrl as string | undefined;
      let meta: Record<string, unknown> = (p.attachmentMeta as Record<string, unknown>) ?? {};

      if (!attachmentUrl) {
        if (!localFile?.uri) {
          // fichier introuvable -> échec définitif
          throw new ApiError(422, 'fichier local manquant', 'local_file_missing');
        }
        const up = await mediaService.upload(localFile);
        attachmentUrl = up.url;
        meta = {
          ...meta,
          thumbnail_url: up.thumbnail_url ?? meta.thumbnail_url,
          width: up.width ?? meta.width,
          height: up.height ?? meta.height,
          duration_sec: up.duration_sec ?? meta.duration_sec,
          size: up.size ?? meta.size,
        };
        // mémorise l'URL pour ne pas ré-uploader si l'envoi échoue ensuite
        p.attachmentUrl = attachmentUrl;
        p.attachmentMeta = meta;
        await run('UPDATE outbox SET payload_json=? WHERE id=?', [
          JSON.stringify(p),
          entry.id,
        ]);
        // le fichier que l'utilisateur vient d'envoyer -> on le range dans le
        // cache disque SOUS l'URL serveur, pour que <CachedImage> l'affiche
        // sans re-télécharger (et même hors-ligne juste après).
        await mediaCache.adopt(attachmentUrl, localFile.uri);
        if (meta.thumbnail_url && typeof meta.thumbnail_url === 'string') {
          await mediaCache.adopt(meta.thumbnail_url as string, localFile.uri);
        }
        // met à jour la ligne locale : l'aperçu pointe désormais vers le serveur
        await messageRepo.setAttachment(entry.client_id, attachmentUrl, meta);
      }

      const saved = await apiClient.post<ChatMessage>(
        Endpoints.conversations.messages(p.conversationId as string),
        {
          type: p.type ?? 'file',
          body: p.body ?? '',
          encrypted: false,
          attachment_url: attachmentUrl,
          attachment_meta: meta,
          reply_to_id: p.replyToId ?? undefined,
          client_id: entry.client_id,
        },
      );
      await messageRepo.confirmSent(entry.client_id, { ...saved, body: saved.body });
      await conversationRepo.touchLastMessage(
        p.conversationId as string,
        ATTACH_PREVIEW[saved.type] || saved.body || '',
        saved.type,
        saved.encrypted,
        saved.created_at,
      );
      notifyMutationApplied({ conversationId: p.conversationId as string });
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

    case 'update_me': {
      // fusionne les patchs `update_me` en attente en UN seul PATCH (dernier
      // gagne par clé), puis adopte la version serveur dans le cache.
      const merged: Record<string, unknown> = {};
      const dueList = await outbox.due();
      for (const e of dueList) {
        if (e.kind === 'update_me') {
          Object.assign(merged, (e.payload.patch as Record<string, unknown>) ?? {});
        }
      }
      const me = await apiClient.patch<import('@/types').UserMe>(
        Endpoints.users.updateMe,
        merged,
      );
      await import('@/services/authService').then((m) => m.authService.setCachedMe(me));
      // retire les AUTRES entrées update_me déjà couvertes par ce PATCH
      for (const e of dueList) {
        if (e.kind === 'update_me' && e.id !== entry.id) await outbox.remove(e.id);
      }
      break;
    }
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

    // ── Groupes ──────────────────────────────────────────────────────────
    case 'send_group_message': {
      const saved = await apiClient.post<GroupMessage>(
        Endpoints.groups.messages(p.groupId as string),
        {
          type: p.type ?? 'text',
          body: p.body ?? '',
          client_id: entry.client_id,
        },
      );
      await groupRepo.confirmSent(entry.client_id, saved);
      await groupRepo.touchLastMessage(
        p.groupId as string,
        saved.body || ATTACH_PREVIEW[saved.type] || '',
        saved.created_at,
      );
      notifyMutationApplied({ groupId: p.groupId as string });
      break;
    }

    case 'upload_group_message': {
      const localFile = p.localFile as UploadFile | undefined;
      let attachmentUrl = p.attachmentUrl as string | undefined;
      let meta: Record<string, unknown> = (p.attachmentMeta as Record<string, unknown>) ?? {};

      if (!attachmentUrl) {
        if (!localFile?.uri) {
          throw new ApiError(422, 'fichier local manquant', 'local_file_missing');
        }
        const up = await mediaService.upload(localFile);
        attachmentUrl = up.url;
        meta = {
          ...meta,
          thumbnail_url: up.thumbnail_url ?? meta.thumbnail_url,
          width: up.width ?? meta.width,
          height: up.height ?? meta.height,
          duration_sec: up.duration_sec ?? meta.duration_sec,
          size: up.size ?? meta.size,
        };
        p.attachmentUrl = attachmentUrl;
        p.attachmentMeta = meta;
        await run('UPDATE outbox SET payload_json=? WHERE id=?', [JSON.stringify(p), entry.id]);
        await mediaCache.adopt(attachmentUrl, localFile.uri);
        if (meta.thumbnail_url && typeof meta.thumbnail_url === 'string') {
          await mediaCache.adopt(meta.thumbnail_url as string, localFile.uri);
        }
        await groupRepo.setAttachment(entry.client_id, attachmentUrl, meta);
      }

      const saved = await apiClient.post<GroupMessage>(
        Endpoints.groups.messages(p.groupId as string),
        {
          type: p.type ?? 'image',
          body: p.body ?? '',
          attachment_url: attachmentUrl,
          attachment_meta: meta,
          client_id: entry.client_id,
        },
      );
      await groupRepo.confirmSent(entry.client_id, saved);
      await groupRepo.touchLastMessage(
        p.groupId as string,
        ATTACH_PREVIEW[saved.type] || saved.body || '',
        saved.created_at,
      );
      notifyMutationApplied({ groupId: p.groupId as string });
      break;
    }

    case 'group_mark_read':
      await apiClient.put(Endpoints.groups.read(p.groupId as string));
      break;

    case 'group_mute':
      await (p.muted
        ? apiClient.put(Endpoints.groups.mute(p.groupId as string))
        : apiClient.put(Endpoints.groups.unmute(p.groupId as string)));
      await groupRepo.markSynced(p.groupId as string);
      break;

    case 'group_update': {
      const saved = await apiClient.patch<Group>(
        Endpoints.groups.byId(p.groupId as string),
        (p.patch as Record<string, unknown>) ?? {},
      );
      await groupRepo.upsertFromServer(saved);
      notifyMutationApplied({ groupId: p.groupId as string });
      break;
    }

    case 'group_member_role':
      await apiClient.put(
        Endpoints.groups.memberRole(p.groupId as string, p.userId as string),
        { role: p.role },
      );
      notifyMutationApplied({ groupId: p.groupId as string });
      break;

    case 'group_member_remove':
      await apiClient.delete(
        Endpoints.groups.removeMember(p.groupId as string, p.userId as string),
      );
      notifyMutationApplied({ groupId: p.groupId as string });
      break;

    case 'group_leave':
      await apiClient.post(Endpoints.groups.leave(p.groupId as string));
      break;

    case 'group_delete':
      await apiClient.delete(Endpoints.groups.byId(p.groupId as string));
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
      const isMsgKind = entry.kind === 'send_message' || entry.kind === 'upload_message';
      const isGroupMsgKind =
        entry.kind === 'send_group_message' || entry.kind === 'upload_group_message';
      const markFailed = async () => {
        if (isMsgKind) await messageRepo.markFailed(entry.client_id);
        else if (isGroupMsgKind) await groupRepo.markFailed(entry.client_id);
      };
      if (isClient) {
        // Erreur définitive (validation, conflit non idempotent, droit) :
        // on abandonne l'entrée et on marque la ligne locale en échec.
        await outbox.remove(entry.id);
        await markFailed();
      } else {
        const outcome = await outbox.retryLater(entry, (err as Error).message);
        if (outcome === 'gaveup' && (isMsgKind || isGroupMsgKind)) {
          await markFailed();
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

  // ── Groupes & chaînes : liste + historique récent des groupes déjà ouverts
  //    (ou avec des non-lus). On ne télécharge PAS tout l'historique de tous
  //    les groupes à chaque sync — seulement ce qui est pertinent.
  try {
    const groups = await apiClient.get<Group[]>(Endpoints.groups.list);
    await groupRepo.bulkReplace(groups);
    const opened = await groupRepo.groupIdsWithMessages();
    for (const g of groups) {
      if (!opened.has(g.id) && g.unread_count === 0) continue;
      const hist = await apiClient.get<GroupMessage[]>(Endpoints.groups.messages(g.id));
      for (const m of hist) await groupRepo.upsertMessageFromServer(m);
    }
  } catch (e) {
    console.warn('[sync] pull groupes:', (e as Error).message);
  }

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

/**
 * Pousse l'outbox MAINTENANT — léger, sans pull. À appeler juste après un
 * envoi (message, réaction, lecture…) pour que ça parte sans attendre le
 * cycle complet. Coalesce les appels rapprochés ; si un push tourne déjà,
 * on redéclenche une passe à la fin.
 */
// branche l'auto-push : toute entrée d'outbox déclenche un pushNow immédiat
setOnEnqueued(() => {
  void pushNow();
});

export async function pushNow(): Promise<void> {
  if (pushing) {
    pushAgain = true;
    return;
  }
  pushing = true;
  try {
    do {
      pushAgain = false;
      await pushOutbox();
    } while (pushAgain);
  } catch (e) {
    console.warn('[sync] pushNow interrompu:', (e as Error).message);
  } finally {
    pushing = false;
    emit('idle', await outbox.count());
  }
}

export async function syncNow(opts?: { force?: boolean }): Promise<void> {
  if (running) return;
  if (!opts?.force && Date.now() - lastRunAt < MIN_INTERVAL_MS) return;
  running = true;
  lastRunAt = Date.now();
  try {
    // le push passe par pushNow() pour ne pas doubler avec un envoi manuel
    if (!pushing) await pushNow();
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
