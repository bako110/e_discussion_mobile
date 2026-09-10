import { apiClient, Endpoints } from '@/api';
import { authService } from '@/services/authService';
import { newClientId, outbox } from '@/sync/outbox';
import type { ContactMatch, PrivacyLevel, UserMe, UserPublic } from '@/types';
import { storage } from '@/utils/storage';

const KNOWN_CONTACT_IDS = 'contacts.knownIds';

type MePatch = Partial<
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
    | 'call_ringtone'
    | 'call_vibrate'
    | 'call_answer_on_speaker'
    | 'call_low_data'
    | 'call_block_unknown'
  >
>;

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
  async contacts(): Promise<UserPublic[]> {
    const list = await apiClient.get<UserPublic[]>(Endpoints.contacts.list);
    // cache local des IDs -> blocage des appels d'inconnus (CallContext)
    storage.setJSON(KNOWN_CONTACT_IDS, list.map((u) => u.id));
    return list;
  },

  /** IDs des contacts connus (cache MMKV alimenté par `contacts()`). */
  knownContactIds(): string[] {
    return storage.getJSON<string[]>(KNOWN_CONTACT_IDS) ?? [];
  },

  getById(id: string): Promise<UserPublic> {
    return apiClient.get<UserPublic>(Endpoints.users.byId(id));
  },

  /**
   * Met à jour le profil / les réglages `users.*` — LOCAL-FIRST :
   *  1. fusion optimiste dans le cache MMKV (`me`) -> effet immédiat, hors-ligne OK ;
   *  2. mutation empilée dans l'outbox (`update_me`) -> rejouée au retour du réseau.
   *
   * `username` reste en ligne obligatoire (unicité à valider côté serveur) :
   * si `patch` contient `username`, on passe par l'appel direct.
   */
  async updateMe(patch: MePatch): Promise<UserMe> {
    // username : validation serveur requise -> appel direct
    if ('username' in patch) {
      const me = await apiClient.patch<UserMe>(Endpoints.users.updateMe, patch);
      authService.setCachedMe(me);
      return me;
    }
    const local = authService.patchCachedMe(patch as Partial<UserMe>);
    await outbox.enqueue('update_me', newClientId(), { patch });
    return (local ?? (await apiClient.patch<UserMe>(Endpoints.users.updateMe, patch))) as UserMe;
  },

  /** Raccourci pour un réglage de confidentialité (local-first). */
  setPrivacy(
    key: 'last_seen_privacy' | 'profile_photo_privacy' | 'about_privacy',
    level: PrivacyLevel,
  ): Promise<UserMe> {
    return userService.updateMe({ [key]: level } as MePatch);
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
