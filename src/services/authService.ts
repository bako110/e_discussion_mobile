/**
 * Authentification — TELEPHONE UNIQUEMENT, sans mot de passe (facon WhatsApp).
 *
 *   1. phoneStart(e164)          -> le serveur cree le compte si besoin + envoie le code SMS
 *   2. phoneVerify(e164, code)   -> tokens + { profile_complete, is_new_user }
 *   3. si !profile_complete      -> ecran nom + username, puis updateProfile()
 *
 * Les tokens sont stockes dans le Keychain (protection materielle),
 * jamais dans MMKV non chiffre.
 *
 * Multi-compte (jusqu'à 4, façon Gmail) : chaque compte a sa PROPRE entrée
 * Keychain et son propre cache profil MMKV, partitionnés par `accountId`
 * (= user.id). `setActiveAccountId()` fixe le compte sur lequel ce module
 * opère — appelé par accountSwitch.ts à chaque bascule. Les fonctions qui ne
 * prennent pas explicitement d'accountId (getCachedMe, setCachedMe,
 * patchCachedMe, bootstrap, logout…) agissent TOUJOURS sur le compte actif
 * courant, pour ne pas devoir modifier tous leurs appelants existants.
 */
import { Platform } from 'react-native';
import * as Keychain from 'react-native-keychain';

import {
  apiClient,
  Endpoints,
  setAccessToken,
  setOnUnauthorized,
  setRefreshFn,
} from '@/api';
import type { AuthResult, PhoneStartOut, UserMe } from '@/types';
import { storage } from '@/utils/storage';

const KEYCHAIN_SERVICE_PREFIX = 'ediscussion-auth-tokens';
const CACHED_ME_PREFIX = 'cached_me';

interface StoredTokens {
  access: string;
  refresh: string;
}

function deviceHeaders(): Record<string, string> {
  return {
    'X-Device-Name': Platform.OS === 'ios' ? 'iPhone' : 'Android',
    'X-Platform': Platform.OS,
  };
}

// compte sur lequel ce module opère actuellement — fixé par setActiveAccountId()
let activeAccountId: string | null = null;
let cachedMe: UserMe | null = null;

function keychainService(accountId: string): string {
  return `${KEYCHAIN_SERVICE_PREFIX}-${accountId}`;
}

function cachedMeKey(accountId: string): string {
  return `${CACHED_ME_PREFIX}_${accountId}`;
}

async function persistTokens(accountId: string, access: string, refresh: string): Promise<void> {
  await Keychain.setGenericPassword('tokens', JSON.stringify({ access, refresh }), {
    service: keychainService(accountId),
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  if (accountId === activeAccountId) setAccessToken(access);
}

async function readTokens(accountId: string): Promise<StoredTokens | null> {
  const creds = await Keychain.getGenericPassword({ service: keychainService(accountId) });
  if (!creds || !creds.password) return null;
  try {
    return JSON.parse(creds.password) as StoredTokens;
  } catch {
    return null;
  }
}

async function clearTokens(accountId: string): Promise<void> {
  await Keychain.resetGenericPassword({ service: keychainService(accountId) });
  storage.delete(cachedMeKey(accountId));
  if (accountId === activeAccountId) {
    setAccessToken(null);
    cachedMe = null;
  }
}

function remember(accountId: string, res: AuthResult): void {
  storage.setJSON(cachedMeKey(accountId), res.user);
  if (accountId === activeAccountId) cachedMe = res.user;
}

export const authService = {
  /** Fixe le compte sur lequel ce module opère (Keychain/cache profil ciblés
   * par les fonctions sans accountId explicite). Appelé par accountSwitch.ts
   * à chaque bascule, et une fois au démarrage avec le compte actif du
   * registre. Ne fait AUCUN appel réseau — juste un aiguillage local. */
  setActiveAccountId(accountId: string | null): void {
    activeAccountId = accountId;
    cachedMe = accountId ? storage.getJSON<UserMe>(cachedMeKey(accountId)) : null;
  },

  /** Compte sur lequel ce module opère actuellement — pour tout autre
   * service (storyService, callService…) qui a besoin de partitionner SON
   * PROPRE cache MMKV par compte, exactement comme cached_me/Keychain le
   * sont déjà ici. */
  getActiveAccountId(): string | null {
    return activeAccountId;
  },

  /** Au demarrage (ou à chaque bascule) : recharge les tokens du compte
   * ACTUELLEMENT actif (voir setActiveAccountId) et branche le refresh
   * automatique sur ce même compte. */
  async bootstrap(onUnauthorized: () => void): Promise<boolean> {
    setRefreshFn(async () => {
      const id = activeAccountId;
      if (!id) throw new Error('no active account');
      const stored = await readTokens(id);
      if (!stored) throw new Error('no refresh token');
      const res = await apiClient.post<AuthResult>(Endpoints.auth.refresh, {
        refresh_token: stored.refresh,
      });
      await persistTokens(id, res.access_token, res.refresh_token);
      return res.access_token;
    });
    setOnUnauthorized(async () => {
      if (activeAccountId) await clearTokens(activeAccountId);
      onUnauthorized();
    });

    if (!activeAccountId) return false;
    const stored = await readTokens(activeAccountId);
    if (!stored) return false;
    setAccessToken(stored.access);
    return true;
  },

  // ── Etape 1 : envoi du code ──────────────────────────────────────────
  async phoneStart(e164: string): Promise<PhoneStartOut> {
    return apiClient.post<PhoneStartOut>(
      Endpoints.auth.phoneStart,
      { phone: e164 },
      { headers: deviceHeaders() },
    );
  },

  // ── Etape 2 : verification du code -> session ────────────────────────
  /** Vérifie le code et persiste les tokens SOUS `res.user.id` — n'active
   * PAS automatiquement ce compte (voir setActiveAccountId), pour permettre
   * de vérifier un 2e/3e/4e compte sans perturber le compte actif courant
   * pendant le flux d'ajout. */
  async phoneVerify(e164: string, code: string): Promise<AuthResult> {
    const res = await apiClient.post<AuthResult>(
      Endpoints.auth.phoneVerify,
      { phone: e164, code },
      { headers: deviceHeaders() },
    );
    await persistTokens(res.user.id, res.access_token, res.refresh_token);
    remember(res.user.id, res);
    return res;
  },

  // ── Etape 3 : completer le profil (nom + username) ───────────────────
  async updateProfile(input: { display_name: string; username: string }): Promise<UserMe> {
    const me = await apiClient.patch<UserMe>(Endpoints.users.updateMe, input);
    if (activeAccountId) {
      cachedMe = me;
      storage.setJSON(cachedMeKey(activeAccountId), me);
    }
    return me;
  },

  // ── Session ─────────────────────────────────────────────────────────
  async getMe(forceRefresh = false): Promise<UserMe> {
    if (!forceRefresh && cachedMe) return cachedMe;
    try {
      const me = await apiClient.get<UserMe>(Endpoints.auth.me);
      if (activeAccountId) {
        cachedMe = me;
        storage.setJSON(cachedMeKey(activeAccountId), me);
      }
      return me;
    } catch (err) {
      const offline = activeAccountId
        ? storage.getJSON<UserMe>(cachedMeKey(activeAccountId))
        : null;
      if (offline) {
        cachedMe = offline;
        return offline;
      }
      throw err;
    }
  },

  // ── Lier un identifiant secondaire (e-mail / numero) au compte ───────
  /** Envoie un OTP vers `identifier` pour le lier au compte courant. */
  async requestLinkOtp(identifier: string, kind: 'email' | 'phone'): Promise<void> {
    await apiClient.post(Endpoints.auth.otpSend, {
      identifier,
      purpose: kind === 'email' ? 'link_email' : 'link_phone',
    });
  },

  /** Confirme le code et lie l'e-mail au compte -> renvoie le profil a jour. */
  async linkEmail(email: string, code: string): Promise<UserMe> {
    const me = await apiClient.post<UserMe>(Endpoints.auth.linkEmail, { email, code });
    if (activeAccountId) {
      cachedMe = me;
      storage.setJSON(cachedMeKey(activeAccountId), me);
    }
    return me;
  },

  /** Confirme le code et lie le numero au compte -> renvoie le profil a jour. */
  async linkPhone(phone: string, code: string): Promise<UserMe> {
    const me = await apiClient.post<UserMe>(Endpoints.auth.linkPhone, { phone, code });
    if (activeAccountId) {
      cachedMe = me;
      storage.setJSON(cachedMeKey(activeAccountId), me);
    }
    return me;
  },

  /** Déconnecte le compte ACTUELLEMENT actif (voir setActiveAccountId) :
   * révoque le refresh token côté serveur puis nettoie son Keychain/cache
   * local. N'affecte aucun autre compte du registre. */
  async logout(): Promise<void> {
    const id = activeAccountId;
    if (!id) return;
    const stored = await readTokens(id);
    try {
      await apiClient.post(Endpoints.auth.logout, { refresh_token: stored?.refresh });
    } catch {
      // on nettoie localement quoi qu'il arrive
    }
    await clearTokens(id);
  },

  /** Archive JSON de toutes mes données (portabilité / RGPD). */
  exportMyData(): Promise<unknown> {
    return apiClient.get<unknown>(Endpoints.auth.exportMe);
  },

  /** Envoie un code OTP (SMS/e-mail) sur l'identifiant déjà lié au compte —
   * requis avant `deleteAccount`. Le backend refuse la suppression sans un
   * code valide (évite qu'un appel accidentel/automatisé supprime le compte
   * sans confirmation explicite de l'utilisateur). */
  async requestAccountDeleteOtp(identifier: string): Promise<void> {
    await apiClient.post(Endpoints.auth.otpSend, {
      identifier,
      purpose: 'account_delete',
    });
  },

  /** Supprime DÉFINITIVEMENT le compte ACTIF côté serveur (avec le code OTP
   * reçu via `requestAccountDeleteOtp`), puis nettoie le local. */
  async deleteAccount(code: string): Promise<void> {
    await apiClient.delete(Endpoints.auth.deleteMe, { code });
    if (activeAccountId) await clearTokens(activeAccountId);
  },

  getCachedMe(): UserMe | null {
    return cachedMe ?? (activeAccountId ? storage.getJSON<UserMe>(cachedMeKey(activeAccountId)) : null);
  },

  /** Fusionne `patch` dans le profil en cache (mise à jour optimiste locale,
   * hors-ligne OK). Le serveur est mis à jour à part (outbox `update_me`). */
  patchCachedMe(patch: Partial<UserMe>): UserMe | null {
    if (!activeAccountId) return null;
    const cur = cachedMe ?? storage.getJSON<UserMe>(cachedMeKey(activeAccountId));
    if (!cur) return null;
    const next = { ...cur, ...patch } as UserMe;
    cachedMe = next;
    storage.setJSON(cachedMeKey(activeAccountId), next);
    return next;
  },

  /** Remplace le profil en cache par la version serveur. */
  setCachedMe(me: UserMe): void {
    if (!activeAccountId) return;
    cachedMe = me;
    storage.setJSON(cachedMeKey(activeAccountId), me);
  },

  profileComplete(me: UserMe | null): boolean {
    return !!(me && me.display_name && me.username);
  },
};
