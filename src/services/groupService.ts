/**
 * Groupes & chaînes — LOCAL-FIRST (comme le 1-to-1).
 *
 *  - `list()` / `messages()` / `get()` : lisent SQLite (`groupRepo`).
 *    Instantané, hors-ligne OK. Le rafraîchissement serveur se fait via
 *    `refreshList()` / `refreshMessages()` (best-effort, silencieux si offline).
 *  - `send()` : insère un message optimiste + empile l'outbox
 *    (`send_group_message`). `sendMedia()` : idem mais upload différé
 *    (`upload_group_message`).
 *  - Opérations qui EXIGENT le serveur (création, rejoindre, aperçu, membres,
 *    quitter, éditer les infos) : lèvent si hors-ligne — l'appelant affiche
 *    « connexion requise ».
 */
import { apiClient, Endpoints } from '@/api';
import { groupRepo, type LocalGroup, type LocalGroupMessage } from '@/db/repositories/groupRepo';
import type {
  CreateGroupInput,
  Group,
  GroupJoinRequest,
  GroupKind,
  GroupMember,
  GroupMessage,
  GroupPreview,
  GroupSettings,
} from '@/types';
import { newClientId, outbox } from '@/sync/outbox';

const PREVIEW: Record<string, string> = {
  image: 'Photo',
  video: 'Vidéo',
  voice: 'Message vocal',
  file: 'Document',
};

export const groupService = {
  // ── Lecture locale ─────────────────────────────────────────────────────
  list(kind?: GroupKind): Promise<LocalGroup[]> {
    return groupRepo.list().then((all) => (kind ? all.filter((g) => g.kind === kind) : all));
  },

  get(id: string): Promise<LocalGroup | null> {
    return groupRepo.get(id);
  },

  messages(id: string, beforeCreatedAt?: string): Promise<LocalGroupMessage[]> {
    return groupRepo.page(id, 40, beforeCreatedAt);
  },

  // ── Rafraîchissement serveur (best-effort) ─────────────────────────────
  /** Récupère mes groupes/chaînes et les fusionne en local. */
  async refreshList(): Promise<void> {
    const remote = await apiClient.get<Group[]>(Endpoints.groups.list);
    await groupRepo.bulkReplace(remote);
  },

  /** Recharge l'entête + l'historique récent d'un groupe. */
  async refreshMessages(id: string): Promise<void> {
    const [g, hist] = await Promise.all([
      apiClient.get<Group>(Endpoints.groups.byId(id)),
      apiClient.get<GroupMessage[]>(Endpoints.groups.messages(id)),
    ]);
    await groupRepo.upsertFromServer(g);
    for (const m of hist) await groupRepo.upsertMessageFromServer(m);
  },

  /** Applique un message reçu en temps réel (WS `group.message`). */
  async ingestRealtime(m: GroupMessage): Promise<void> {
    await groupRepo.upsertMessageFromServer(m);
    await groupRepo.touchLastMessage(
      m.group_id,
      m.body || PREVIEW[m.type] || '',
      m.created_at,
    );
  },

  // ── Envoi local-first ──────────────────────────────────────────────────
  async send(
    id: string,
    body: string,
    opts?: { senderId?: string },
  ): Promise<LocalGroupMessage | null> {
    const plain = body.trim();
    if (!plain) return null;
    const clientId = newClientId();
    const createdAt = new Date().toISOString();

    await groupRepo.insertOutgoing({
      clientId,
      groupId: id,
      senderId: opts?.senderId ?? '',
      type: 'text',
      body: plain,
      createdAt,
    });
    await groupRepo.touchLastMessage(id, plain, createdAt);
    await outbox.enqueue('send_group_message', clientId, {
      groupId: id,
      type: 'text',
      body: plain,
    });
    return groupRepo.getByClientId(clientId);
  },

  /** Média offline-first : message optimiste + upload différé. */
  async sendMedia(p: {
    groupId: string;
    senderId: string;
    localFile: { uri: string; name: string; type: string };
    kind: 'image' | 'video' | 'file' | 'voice';
    meta?: Record<string, unknown>;
  }): Promise<void> {
    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    const meta: Record<string, unknown> = {
      ...(p.meta ?? {}),
      name: p.localFile.name,
      mime: p.localFile.type,
      thumbnail_url:
        p.kind === 'image' || p.kind === 'video' ? p.localFile.uri : undefined,
    };
    await groupRepo.insertOutgoing({
      clientId,
      groupId: p.groupId,
      senderId: p.senderId,
      type: p.kind,
      body: '',
      attachmentUrl: p.localFile.uri,
      attachmentMeta: meta,
      createdAt,
    });
    await groupRepo.touchLastMessage(p.groupId, PREVIEW[p.kind] || '', createdAt);
    await outbox.enqueue('upload_group_message', clientId, {
      groupId: p.groupId,
      type: p.kind,
      localFile: p.localFile,
      attachmentMeta: meta,
    });
  },

  async markRead(id: string): Promise<void> {
    await groupRepo.setUnread(id, 0);
    await outbox.enqueue('group_mark_read', newClientId(), { groupId: id });
  },

  async setMuted(id: string, muted: boolean): Promise<void> {
    await groupRepo.setMuted(id, muted);
    await outbox.enqueue('group_mute', newClientId(), { groupId: id, muted });
  },

  // ── Opérations EN LIGNE OBLIGATOIRE ────────────────────────────────────
  async create(input: CreateGroupInput): Promise<Group> {
    const g = await apiClient.post<Group>(Endpoints.groups.create, {
      kind: input.kind,
      name: input.name,
      description: input.description ?? undefined,
      avatar_url: input.avatar_url ?? undefined,
      is_public: input.is_public ?? true,
      member_ids: input.member_ids ?? [],
    });
    await groupRepo.upsertFromServer(g);
    return g;
  },

  /**
   * Édite nom / description / avatar / is_public — LOCAL-FIRST : la ligne
   * locale est mise à jour tout de suite, la requête part par l'outbox et
   * se rejoue au retour du réseau.
   */
  async update(
    id: string,
    patch: Partial<Pick<Group, 'name' | 'description' | 'avatar_url' | 'is_public'>>,
  ): Promise<void> {
    await groupRepo.patchLocal(id, patch);
    await outbox.enqueue('group_update', newClientId(), { groupId: id, patch });
  },

  members(id: string): Promise<GroupMember[]> {
    return apiClient.get<GroupMember[]>(Endpoints.groups.members(id));
  },

  preview(code: string): Promise<GroupPreview> {
    return apiClient.get<GroupPreview>(Endpoints.groups.preview(code));
  },

  async join(inviteCode: string): Promise<Group> {
    const g = await apiClient.post<Group>(Endpoints.groups.join, { invite_code: inviteCode });
    await groupRepo.upsertFromServer(g);
    return g;
  },

  /** Quitter — retire le groupe en local tout de suite, la requête part par l'outbox. */
  async leave(id: string): Promise<void> {
    await groupRepo.removeGroup(id);
    await outbox.enqueue('group_leave', newClientId(), { groupId: id });
  },

  /** Supprimer (owner) — idem, purge locale + outbox. */
  async remove(id: string): Promise<void> {
    await groupRepo.removeGroup(id);
    await outbox.enqueue('group_delete', newClientId(), { groupId: id });
  },

  /** Change le rôle d'un membre (admin ↔ membre/abonné). En ligne + retry outbox. */
  async setMemberRole(
    id: string,
    userId: string,
    role: 'owner' | 'admin' | 'member' | 'subscriber',
  ): Promise<void> {
    await outbox.enqueue('group_member_role', newClientId(), { groupId: id, userId, role });
  },

  /** Retire un membre. En ligne + retry outbox. */
  async removeMember(id: string, userId: string): Promise<void> {
    await outbox.enqueue('group_member_remove', newClientId(), { groupId: id, userId });
  },

  /** Ajoute des membres (EN LIGNE — a besoin de résoudre les users côté serveur). */
  async addMembers(id: string, userIds: string[]): Promise<GroupMember[]> {
    return apiClient.post<GroupMember[]>(Endpoints.groups.members(id), { user_ids: userIds });
  },

  /** Régénère le lien d'invitation (EN LIGNE). */
  async resetInvite(id: string): Promise<Group> {
    const g = await apiClient.post<Group>(Endpoints.groups.inviteReset(id));
    await groupRepo.upsertFromServer(g);
    return g;
  },

  // ── Paramètres du groupe (admin, EN LIGNE) ────────────────────────────
  getSettings(id: string): Promise<GroupSettings> {
    return apiClient.get<GroupSettings>(Endpoints.groups.settings(id));
  },
  async setSettings(id: string, patch: Partial<GroupSettings>): Promise<Group> {
    const g = await apiClient.put<Group>(Endpoints.groups.settings(id), patch);
    await groupRepo.upsertFromServer(g);
    return g;
  },
  joinRequests(id: string): Promise<GroupJoinRequest[]> {
    return apiClient.get<GroupJoinRequest[]>(Endpoints.groups.joinRequests(id));
  },
  approveJoin(id: string, userId: string): Promise<void> {
    return apiClient.post(Endpoints.groups.approveJoin(id, userId)).then(() => undefined);
  },
  rejectJoin(id: string, userId: string): Promise<void> {
    return apiClient.post(Endpoints.groups.rejectJoin(id, userId)).then(() => undefined);
  },
};
