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
  const [status, setStatus] = useState<Status>('loading');
  const [me, setMe] = useState<UserMe | null>(null);

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
        const cached = authService.getCachedMe();
        if (!cancelled) {
          if (cached) applySession(cached);
          else setStatus('unauthenticated');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySession]);

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
