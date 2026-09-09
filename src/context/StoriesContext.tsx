/**
 * État partagé des stories (statuts éphémères).
 *
 * Centralise le feed des contacts + mes propres stories pour éviter que
 * chaque écran refasse les mêmes requêtes, et expose `unseenCount` (nombre
 * d'auteurs ayant au moins une story non vue) pour le badge de l'onglet.
 *
 * Se rafraîchit : au montage, puis sur tout event WebSocket `story.*`.
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
import { storyService } from '@/services';
import type { Story, StoryFeedItem } from '@/types';

interface StoriesContextValue {
  feed: StoryFeedItem[];
  mine: Story[];
  loading: boolean;
  /** Nombre d'auteurs (contacts) avec au moins une story non vue. */
  unseenCount: number;
  /** Total de vues cumulées sur mes stories actives. */
  myViews: number;
  reload: () => Promise<void>;
}

const StoriesContext = createContext<StoriesContextValue | null>(null);

export const StoriesProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { addListener } = useWs();
  const [feed, setFeed] = useState<StoryFeedItem[]>([]);
  const [mine, setMine] = useState<Story[]>([]);
  const [loading, setLoading] = useState(true);
  const inFlight = useRef(false);

  const reload = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const [f, m] = await Promise.all([storyService.feed(), storyService.mine()]);
      setFeed(f);
      setMine(m);
    } catch {
      /* hors ligne — on garde le cache mémoire */
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
      if (String(e.type).startsWith('story.')) void reload();
    }),
    [addListener, reload],
  );

  const value = useMemo<StoriesContextValue>(() => {
    const unseenCount = feed.filter((f) => f.has_unseen).length;
    const myViews = mine.reduce((n, s) => n + s.view_count, 0);
    return { feed, mine, loading, unseenCount, myViews, reload };
  }, [feed, mine, loading, reload]);

  return <StoriesContext.Provider value={value}>{children}</StoriesContext.Provider>;
};

export function useStories(): StoriesContextValue {
  const ctx = useContext(StoriesContext);
  if (!ctx) throw new Error('useStories must be used within StoriesProvider');
  return ctx;
}
