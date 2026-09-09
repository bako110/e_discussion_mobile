/**
 * Session utilisateur — etat d'auth global.
 *
 * status :
 *   loading         verification des tokens au demarrage
 *   unauthenticated pas de session -> flux telephone
 *   onboarding      session valide MAIS profil incomplet -> ecran nom + username
 *   authenticated   session + profil complet -> l'app
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { ensureDeviceRegistered, refillOneTimePrekeysIfLow } from '@/crypto';
import { authService } from '@/services';
import { unregisterPushToken } from '@/services/pushTokenService';
import { setSyncUser } from '@/sync/syncEngine';
import type { UserMe } from '@/types';

type Status = 'loading' | 'unauthenticated' | 'onboarding' | 'authenticated';

interface AuthContextValue {
  status: Status;
  me: UserMe | null;
  /** Appele apres phoneVerify : route vers onboarding ou l'app selon le profil. */
  setSession: (me: UserMe) => void;
  /** Appele apres completion du profil. */
  completeOnboarding: (me: UserMe) => void;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Démarrage instantané : si un profil est en cache MMKV, on ouvre
  // directement l'app (pas d'écran de chargement React). La vérification des
  // tokens + le refresh réseau se font ensuite en arrière-plan.
  const boot = authService.getCachedMe();
  const [status, setStatus] = useState<Status>(
    boot ? (authService.profileComplete(boot) ? 'authenticated' : 'onboarding') : 'loading',
  );
  const [me, setMe] = useState<UserMe | null>(boot);

  const registerE2EE = useCallback(() => {
    ensureDeviceRegistered()
      .then(() => refillOneTimePrekeysIfLow())
      .catch(() => undefined);
  }, []);

  const applySession = useCallback(
    (user: UserMe) => {
      setMe(user);
      setSyncUser(user.id);
      if (authService.profileComplete(user)) {
        setStatus('authenticated');
        registerE2EE();
      } else {
        setStatus('onboarding');
      }
    },
    [registerE2EE],
  );

  useEffect(() => {
    let cancelled = false;
    const cached = authService.getCachedMe();
    if (cached && authService.profileComplete(cached)) {
      setSyncUser(cached.id); // déjà "authenticated" via l'init de status
      registerE2EE();
    }

    (async () => {
      const hasTokens = await authService.bootstrap(() => {
        if (!cancelled) {
          setMe(null);
          setSyncUser(null);
          setStatus('unauthenticated');
        }
      });
      if (!hasTokens) {
        if (!cancelled) setStatus('unauthenticated');
        return;
      }

      try {
        const user = await authService.getMe(true);
        if (!cancelled) applySession(user);
      } catch {
        if (!cancelled && !cached) setStatus('unauthenticated');
        // si on avait déjà un cache, on reste dans l'app avec ce cache
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession, registerE2EE]);

  const setSession = useCallback((user: UserMe) => applySession(user), [applySession]);

  const completeOnboarding = useCallback(
    (user: UserMe) => {
      setMe(user);
      setStatus('authenticated');
      registerE2EE();
    },
    [registerE2EE],
  );

  const refreshMe = useCallback(async () => {
    const user = await authService.getMe(true);
    setMe(user);
  }, []);

  const signOut = useCallback(async () => {
    await unregisterPushToken().catch(() => undefined);
    await authService.logout();
    setMe(null);
    setSyncUser(null);
    setStatus('unauthenticated');
  }, []);

  const value = useMemo(
    () => ({ status, me, setSession, completeOnboarding, refreshMe, signOut }),
    [status, me, setSession, completeOnboarding, refreshMe, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
