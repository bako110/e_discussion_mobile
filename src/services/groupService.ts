import { apiClient, Endpoints } from '@/api';
import type {
  CreateGroupInput,
  Group,
  GroupKind,
  GroupMember,
  GroupMessage,
  GroupPreview,
} from '@/types';

/**
 * Groupes & chaînes — conversations multi-membres. En ligne uniquement
 * (pas d'offline-first pour l'instant : à aligner sur le 1-to-1 plus tard).
 */
export const groupService = {
  /** Mes groupes + chaînes, ou filtrés par type. */
  list(kind?: GroupKind): Promise<Group[]> {
    return apiClient.get<Group[]>(
      kind ? Endpoints.groups.listByKind(kind) : Endpoints.groups.list,
    );
  },

  /** Crée un groupe ou une chaîne. */
  create(input: CreateGroupInput): Promise<Group> {
    return apiClient.post<Group>(Endpoints.groups.create, {
      kind: input.kind,
      name: input.name,
      description: input.description ?? undefined,
      avatar_url: input.avatar_url ?? undefined,
      is_public: input.is_public ?? true,
      member_ids: input.member_ids ?? [],
    });
  },

  get(id: string): Promise<Group> {
    return apiClient.get<Group>(Endpoints.groups.byId(id));
  },

  update(
    id: string,
    patch: Partial<Pick<Group, 'name' | 'description' | 'avatar_url' | 'is_public'>>,
  ): Promise<Group> {
    return apiClient.patch<Group>(Endpoints.groups.byId(id), patch);
  },

  members(id: string): Promise<GroupMember[]> {
    return apiClient.get<GroupMember[]>(Endpoints.groups.members(id));
  },

  /** Aperçu depuis un code d'invitation (avant de rejoindre — scan QR / lien). */
  preview(code: string): Promise<GroupPreview> {
    return apiClient.get<GroupPreview>(Endpoints.groups.preview(code));
  },

  /** Rejoint via code d'invitation. */
  join(inviteCode: string): Promise<Group> {
    return apiClient.post<Group>(Endpoints.groups.join, { invite_code: inviteCode });
  },

  leave(id: string): Promise<void> {
    return apiClient.post(Endpoints.groups.leave(id)).then(() => undefined);
  },

  setMuted(id: string, muted: boolean): Promise<void> {
    const url = muted ? Endpoints.groups.mute(id) : Endpoints.groups.unmute(id);
    return apiClient.put(url).then(() => undefined);
  },

  /** Historique des messages (plus ancien → plus récent). `before` = ISO. */
  messages(id: string, before?: string): Promise<GroupMessage[]> {
    const q = before ? `?before=${encodeURIComponent(before)}` : '';
    return apiClient.get<GroupMessage[]>(Endpoints.groups.messages(id) + q);
  },

  send(
    id: string,
    body: string,
    opts?: {
      type?: 'text' | 'image' | 'video';
      attachmentUrl?: string;
      attachmentMeta?: Record<string, unknown>;
      clientId?: string;
    },
  ): Promise<GroupMessage> {
    return apiClient.post<GroupMessage>(Endpoints.groups.messages(id), {
      type: opts?.type ?? 'text',
      body,
      attachment_url: opts?.attachmentUrl ?? undefined,
      attachment_meta: opts?.attachmentMeta ?? undefined,
      client_id: opts?.clientId ?? undefined,
    });
  },

  markRead(id: string): Promise<void> {
    return apiClient.put(Endpoints.groups.read(id)).then(() => undefined);
  },
};
