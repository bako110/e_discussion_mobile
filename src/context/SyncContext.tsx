/**
 * État réseau + synchronisation. Fournit :
 *   online       — connectivité (NetInfo)
 *   syncing      — une passe de sync est en cours
 *   pending      — nombre de mutations en attente dans l'outbox
 *   syncNow()    — force une synchro (pull-to-refresh)
 *
 * Déclenche automatiquement `syncNow()` : au montage, au retour du réseau,
 * quand l'app repasse au premier plan.
 */
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import NetInfo from '@react-native-community/netinfo';

import { useAuth } from '@/context/AuthContext';
import { initDb } from '@/db';
import {
  hasContactsPermission,
  neverSyncedContacts,
  syncPhoneContacts,
} from '@/services';
import { outbox } from '@/sync/outbox';
import { onSyncProgress, syncNow } from '@/sync/syncEngine';

interface SyncContextValue {
  ready: boolean;
  online: boolean;
  syncing: boolean;
  pending: number;
  syncNow: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | null>(null);

export const SyncProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { status, me } = useAuth();
  const authed = status === 'authenticated';

  const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [pending, setPending] = useState(0);
  const wasOffline = useRef(false);

  // Init DB une fois (indépendant de l'auth : les données restent en local)
  useEffect(() => {
    initDb()
      .then(() => setReady(true))
      .catch(() => setReady(true));
  }, []);

  // Progression de la sync
  useEffect(() => {
    return onSyncProgress(({ phase, pending: p }) => {
      setSyncing(phase !== 'idle');
      setPending(p);
    });
  }, []);

  // Synchro du carnet d'adresses : au 1er lancement authentifié (si jamais
  // faite), ou à chaque démarrage si la permission est déjà accordée. Silencieux
  // et best-effort — l'écran Réglages permet aussi une synchro manuelle.
  const contactsSynced = useRef(false);
  useEffect(() => {
    if (!authed || contactsSynced.current) return;
    contactsSynced.current = true;
    (async () => {
      try {
        const already = await hasContactsPermission();
        if (already || neverSyncedContacts()) {
          await syncPhoneContacts({
            userPhone: me?.phone ?? null,
            // au 1er lancement on demande la permission, sinon seulement si déjà OK
            askPermission: neverSyncedContacts(),
          });
        }
      } catch {
        /* pas grave — synchro manuelle disponible dans Réglages */
      }
    })();
  }, [authed, me?.phone]);

  const refreshPending = async () => {
    try {
      setPending(await outbox.count());
    } catch {
      /* DB pas prête */
    }
  };

  // Connectivité + déclenchement de sync au retour du réseau
  useEffect(() => {
    if (!ready || !authed) return;

    void syncNow();
    void refreshPending();

    const unsubNet = NetInfo.addEventListener((state) => {
      const nextOnline = !!state.isConnected && state.isInternetReachable !== false;
      setOnline(nextOnline);
      if (nextOnline && wasOffline.current) {
        wasOffline.current = false;
        void syncNow();
      }
      if (!nextOnline) wasOffline.current = true;
    });

    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active') void syncNow();
    });

    // Filet : rejoue l'outbox toutes les 30 s tant qu'il reste des entrées
    const timer = setInterval(async () => {
      if ((await outbox.count()) > 0) void syncNow();
    }, 30_000);

    return () => {
      unsubNet();
      appSub.remove();
      clearInterval(timer);
    };
  }, [ready, authed]);

  const value = useMemo<SyncContextValue>(
    () => ({
      ready,
      online,
      syncing,
      pending,
      syncNow: async () => {
        await syncNow({ force: true });
        await refreshPending();
      },
    }),
    [ready, online, syncing, pending],
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
};

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
