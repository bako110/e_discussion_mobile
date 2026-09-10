import { apiClient, Endpoints } from '@/api';
import { authService } from '@/services/authService';
import { newClientId, outbox } from '@/sync/outbox';
import type { ContactMatch, PrivacyLevel, UserMe, UserPublic } from '@/types';
import { storage } from '@/utils/storage';

const KNOWN_CONTACT_IDS = 'contacts.knownIds';
const PRIVACY_CACHE = 'privacy.settings.cache';

/** Champs de profil réglables. */
export type PrivacyField = 'online' | 'last_seen' | 'profile_photo' | 'about';
/** Modes façon WhatsApp actuel (+ `match_last_seen` pour `online`). */
export type PrivacyMode =
  | 'everyone'
  | 'contacts'
  | 'nobody'
  | 'everyone_except'
  | 'only'
  | 'match_last_seen';

export interface PrivacyFieldState {
  mode: PrivacyMode;
  contact_ids: string[];
}
export type PrivacySettings = Record<PrivacyField, PrivacyFieldState>;

const DEFAULT_PRIVACY: PrivacySettings = {
  online: { mode: 'match_last_seen', contact_ids: [] },
  last_seen: { mode: 'everyone', contact_ids: [] },
  profile_photo: { mode: 'everyone', contact_ids: [] },
  about: { mode: 'everyone', contact_ids: [] },
};

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

  /** Raccourci hérité (mode simple everyone/contacts/nobody). Toujours utilisé
   * par d'anciens écrans ; passe par `update_me`. */
  setPrivacy(
    key: 'last_seen_privacy' | 'profile_photo_privacy' | 'about_privacy',
    level: PrivacyLevel,
  ): Promise<UserMe> {
    return userService.updateMe({ [key]: level } as MePatch);
  },

  // ── Confidentialité du profil : 4 champs, 3 modes + liste (façon WhatsApp) ──
  /** Lecture immédiate depuis le cache (peut être les valeurs par défaut). */
  readPrivacyCache(): PrivacySettings {
    return storage.getJSON<PrivacySettings>(PRIVACY_CACHE) ?? DEFAULT_PRIVACY;
  },

  /** Récupère l'état serveur complet et met à jour le cache. */
  async privacy(): Promise<PrivacySettings> {
    const s = await apiClient.get<PrivacySettings>(Endpoints.users.privacy);
    storage.setJSON(PRIVACY_CACHE, s);
    return s;
  },

  /**
   * Change UN champ (mode + liste) — LOCAL-FIRST : cache mis à jour tout de
   * suite, `PUT /users/me/privacy` rejoué par l'outbox à la reconnexion.
   */
  async setPrivacyField(
    field: PrivacyField,
    mode: PrivacyMode,
    contactIds: string[] = [],
  ): Promise<void> {
    const clean =
      mode === 'everyone_except' || mode === 'only' ? [...new Set(contactIds)] : [];
    const cur = userService.readPrivacyCache();
    const next: PrivacySettings = { ...cur, [field]: { mode, contact_ids: clean } };
    storage.setJSON(PRIVACY_CACHE, next);
    // reflète aussi le champ simple sur le cache `me` (les vieux écrans le lisent)
    if (field !== 'online') {
      authService.patchCachedMe({ [`${field}_privacy`]: mode } as Partial<UserMe>);
    } else {
      authService.patchCachedMe({ online_privacy: mode } as Partial<UserMe>);
    }
    await outbox.enqueue('update_privacy_field', newClientId(), {
      field,
      mode,
      contact_ids: clean,
    });
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
