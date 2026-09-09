/**
 * Authentification — TELEPHONE UNIQUEMENT, sans mot de passe (facon WhatsApp).
 *
 *   1. phoneStart(e164)          -> le serveur cree le compte si besoin + envoie le code SMS
 *   2. phoneVerify(e164, code)   -> tokens + { profile_complete, is_new_user }
 *   3. si !profile_complete      -> ecran nom + username, puis updateProfile()
 *
 * Les tokens sont stockes dans le Keychain (protection materielle),
 * jamais dans MMKV non chiffre.
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
import { StorageKeys, storage } from '@/utils/storage';

const KEYCHAIN_SERVICE = 'ediscussion-auth-tokens';

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

let cachedMe: UserMe | null = null;

async function persistTokens(access: string, refresh: string): Promise<void> {
  await Keychain.setGenericPassword('tokens', JSON.stringify({ access, refresh }), {
    service: KEYCHAIN_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  setAccessToken(access);
}

async function readTokens(): Promise<StoredTokens | null> {
  const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
  if (!creds || !creds.password) return null;
  try {
    return JSON.parse(creds.password) as StoredTokens;
  } catch {
    return null;
  }
}

async function clearTokens(): Promise<void> {
  await Keychain.resetGenericPassword({ service: KEYCHAIN_SERVICE });
  setAccessToken(null);
  cachedMe = null;
  storage.delete(StorageKeys.CACHED_ME);
}

function remember(res: AuthResult): void {
  cachedMe = res.user;
  storage.setJSON(StorageKeys.CACHED_ME, res.user);
}

export const authService = {
  /** Au demarrage : recharge les tokens et branche le refresh automatique. */
  async bootstrap(onUnauthorized: () => void): Promise<boolean> {
    setRefreshFn(async () => {
      const stored = await readTokens();
      if (!stored) throw new Error('no refresh token');
      const res = await apiClient.post<AuthResult>(Endpoints.auth.refresh, {
        refresh_token: stored.refresh,
      });
      await persistTokens(res.access_token, res.refresh_token);
      return res.access_token;
    });
    setOnUnauthorized(async () => {
      await clearTokens();
      onUnauthorized();
    });

    const stored = await readTokens();
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
  async phoneVerify(e164: string, code: string): Promise<AuthResult> {
    const res = await apiClient.post<AuthResult>(
      Endpoints.auth.phoneVerify,
      { phone: e164, code },
      { headers: deviceHeaders() },
    );
    await persistTokens(res.access_token, res.refresh_token);
    remember(res);
    return res;
  },

  // ── Etape 3 : completer le profil (nom + username) ───────────────────
  async updateProfile(input: { display_name: string; username: string }): Promise<UserMe> {
    const me = await apiClient.patch<UserMe>(Endpoints.users.updateMe, input);
    cachedMe = me;
    storage.setJSON(StorageKeys.CACHED_ME, me);
    return me;
  },

  // ── Session ─────────────────────────────────────────────────────────
  async getMe(forceRefresh = false): Promise<UserMe> {
    if (!forceRefresh && cachedMe) return cachedMe;
    try {
      const me = await apiClient.get<UserMe>(Endpoints.auth.me);
      cachedMe = me;
      storage.setJSON(StorageKeys.CACHED_ME, me);
      return me;
    } catch (err) {
      const offline = storage.getJSON<UserMe>(StorageKeys.CACHED_ME);
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
    cachedMe = me;
    storage.setJSON(StorageKeys.CACHED_ME, me);
    return me;
  },

  /** Confirme le code et lie le numero au compte -> renvoie le profil a jour. */
  async linkPhone(phone: string, code: string): Promise<UserMe> {
    const me = await apiClient.post<UserMe>(Endpoints.auth.linkPhone, { phone, code });
    cachedMe = me;
    storage.setJSON(StorageKeys.CACHED_ME, me);
    return me;
  },

  async logout(): Promise<void> {
    const stored = await readTokens();
    try {
      await apiClient.post(Endpoints.auth.logout, { refresh_token: stored?.refresh });
    } catch {
      // on nettoie localement quoi qu'il arrive
    }
    await clearTokens();
  },

  /** Archive JSON de toutes mes données (portabilité / RGPD). */
  exportMyData(): Promise<unknown> {
    return apiClient.get<unknown>(Endpoints.auth.exportMe);
  },

  /** Supprime DÉFINITIVEMENT le compte côté serveur, puis nettoie le local. */
  async deleteAccount(): Promise<void> {
    await apiClient.delete(Endpoints.auth.deleteMe);
    await clearTokens();
  },

  getCachedMe(): UserMe | null {
    return cachedMe ?? storage.getJSON<UserMe>(StorageKeys.CACHED_ME);
  },

  profileComplete(me: UserMe | null): boolean {
    return !!(me && me.display_name && me.username);
  },
};
