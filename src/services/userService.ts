import { apiClient, Endpoints } from '@/api';
import type { ContactMatch, PrivacyLevel, UserMe, UserPublic } from '@/types';

export const userService = {
  search(query: string): Promise<UserPublic[]> {
    if (query.trim().length < 2) return Promise.resolve([]);
    return apiClient.get<UserPublic[]>(Endpoints.users.search(query.trim()));
  },

  /** Utilisateurs que j'ai bloqués. */
  blockedUsers(): Promise<UserPublic[]> {
    return apiClient.get<UserPublic[]>(Endpoints.users.blocked);
  },

  /** Mes contacts E-discussion (repertoire reconnu + conversations existantes). */
  contacts(): Promise<UserPublic[]> {
    return apiClient.get<UserPublic[]>(Endpoints.contacts.list);
  },

  getById(id: string): Promise<UserPublic> {
    return apiClient.get<UserPublic>(Endpoints.users.byId(id));
  },

  updateMe(
    patch: Partial<
      Pick<
        UserMe,
        | 'display_name'
        | 'username'
        | 'about'
        | 'avatar_url'
        | 'locale'
        | 'last_seen_privacy'
        | 'profile_photo_privacy'
        | 'about_privacy'
        | 'read_receipts'
      >
    >,
  ): Promise<UserMe> {
    return apiClient.patch<UserMe>(Endpoints.users.updateMe, patch);
  },

  /** Raccourci pour un réglage de confidentialité. */
  setPrivacy(
    key: 'last_seen_privacy' | 'profile_photo_privacy' | 'about_privacy',
    level: PrivacyLevel,
  ): Promise<UserMe> {
    return apiClient.patch<UserMe>(Endpoints.users.updateMe, { [key]: level });
  },

  block(id: string): Promise<void> {
    return apiClient.post(Endpoints.users.block(id)).then(() => undefined);
  },

  unblock(id: string): Promise<void> {
    return apiClient.delete(Endpoints.users.block(id)).then(() => undefined);
  },

  syncContacts(contacts: { phone: string; display_name?: string }[]): Promise<ContactMatch[]> {
    return apiClient.post<ContactMatch[]>(Endpoints.contacts.sync, { contacts });
  },
};
