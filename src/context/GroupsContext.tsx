/**
 * État partagé des groupes & chaînes.
 *
 * Centralise la liste de mes groupes/chaînes pour l'écran Statut (sections
 * « Groupes & Chaînes ») et expose les compteurs de non-lus. Se rafraîchit
 * sur les events WebSocket `group.*`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useWs } from '@/context/WebSocketContext';
import { groupService } from '@/services';
import { groupRepo, type LocalGroup } from '@/db/repositories/groupRepo';

interface GroupsContextValue {
  groups: LocalGroup[];
  channels: LocalGroup[];
  loading: boolean;
  groupsUnread: number;
  channelsUnread: number;
  reload: () => Promise<void>;
}

const GroupsContext = createContext<GroupsContextValue | null>(null);

export const GroupsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addListener } = useWs();
  const [all, setAll] = useState<LocalGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  /** Lecture LOCALE (instantanée, hors-ligne OK). */
  const readLocal = useCallback(async () => {
    setAll(await groupRepo.list());
    setLoading(false);
  }, []);

  /** Rafraîchit depuis le serveur puis relit le local. Silencieux si offline. */
  const reload = useCallback(async () => {
    await readLocal();
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      await groupService.refreshList();
      await readLocal();
    } catch {
      /* hors ligne — le local reste affiché */
    } finally {
      inFlight.current = false;
    }
  }, [readLocal]);

  useEffect(() => {
    void readLocal();
    void reload();
  }, [readLocal, reload]);

  useEffect(
    () => addListener((e) => {
      if (String(e.type).startsWith('group.')) void reload();
    }),
    [addListener, reload],
  );

  const value = useMemo<GroupsContextValue>(() => {
    const groups = all.filter((g) => g.kind === 'group');
    const channels = all.filter((g) => g.kind === 'channel');
    return {
      groups,
      channels,
      loading,
      groupsUnread: groups.reduce((n, g) => n + g.unread_count, 0),
      channelsUnread: channels.reduce((n, g) => n + g.unread_count, 0),
      reload,
    };
  }, [all, loading, reload]);

  return <GroupsContext.Provider value={value}>{children}</GroupsContext.Provider>;
};

export function useGroups(): GroupsContextValue {
  const ctx = useContext(GroupsContext);
  if (!ctx) throw new Error('useGroups must be used within GroupsProvider');
  return ctx;
}
