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
import type { Group } from '@/types';

interface GroupsContextValue {
  groups: Group[];
  channels: Group[];
  loading: boolean;
  groupsUnread: number;
  channelsUnread: number;
  reload: () => Promise<void>;
}

const GroupsContext = createContext<GroupsContextValue | null>(null);

export const GroupsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addListener } = useWs();
  const [all, setAll] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      setAll(await groupService.list());
    } catch {
      /* hors ligne — cache mémoire conservé */
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

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
