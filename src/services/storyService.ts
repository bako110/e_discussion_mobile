import { apiClient, Endpoints } from '@/api';
import { storage } from '@/utils/storage';
import { mediaCache } from '@/services/mediaCache';
import type {
  CreateStoryInput,
  Story,
  StoryFeedItem,
  StoryViewer,
} from '@/types';

/**
 * Stories — statuts éphémères (24h). LOCAL-FIRST façon WhatsApp :
 *  - le feed et mes stories sont mis en cache MMKV ; hors-ligne on les
 *    affiche encore, en filtrant celles dont `expires_at` est dépassé
 *    (elles disparaissent toutes seules après 24h) ;
 *  - les médias (photo/vidéo/miniature) sont mis sur disque via `mediaCache`
 *    → une story déjà vue s'affiche sans rechargement, même hors-ligne.
 */
const K_FEED = 'stories.feed.cache';
const K_MINE = 'stories.mine.cache';

/** Retire les stories expirées d'un item de feed ; supprime l'item si vide. */
function pruneFeed(items: StoryFeedItem[]): StoryFeedItem[] {
  const now = Date.now();
  return items
    .map((it) => ({
      ...it,
      stories: it.stories.filter((s) => new Date(s.expires_at).getTime() > now),
    }))
    .filter((it) => it.stories.length > 0);
}

function pruneMine(items: Story[]): Story[] {
  const now = Date.now();
  return items.filter((s) => new Date(s.expires_at).getTime() > now);
}

/** Met les médias d'une liste de stories sur le cache disque (fire-and-forget). */
function warmMedia(stories: Story[]): void {
  for (const s of stories) {
    if (s.media_url) mediaCache.resolve(s.media_url);
    if (s.thumbnail_url) mediaCache.resolve(s.thumbnail_url);
  }
}

export const storyService = {
  /** Feed des contacts (cache local) — filtré des stories expirées. */
  readFeedCache(): StoryFeedItem[] {
    return pruneFeed(storage.getJSON<StoryFeedItem[]>(K_FEED) ?? []);
  },
  readMineCache(): Story[] {
    return pruneMine(storage.getJSON<Story[]>(K_MINE) ?? []);
  },

  /** Feed des contacts, groupé par auteur. Met à jour le cache + précharge les médias. */
  async feed(): Promise<StoryFeedItem[]> {
    const f = await apiClient.get<StoryFeedItem[]>(Endpoints.stories.feed);
    storage.setJSON(K_FEED, f);
    f.forEach((it) => warmMedia(it.stories));
    return f;
  },

  /** Mes stories actives. */
  async mine(): Promise<Story[]> {
    const m = await apiClient.get<Story[]>(Endpoints.stories.mine);
    storage.setJSON(K_MINE, m);
    warmMedia(m);
    return m;
  },

  /** Publie une story (en ligne obligatoire). Met à jour le cache `mine`. */
  async create(input: CreateStoryInput): Promise<Story> {
    const story = await apiClient.post<Story>(Endpoints.stories.create, {
      media_type: input.media_type ?? 'text',
      media_url: input.media_url ?? undefined,
      caption: input.caption ?? undefined,
      background_color: input.background_color ?? undefined,
      font: input.font ?? undefined,
      duration_sec: input.duration_sec ?? 5,
      thumbnail_url: input.thumbnail_url ?? undefined,
      audio_url: input.audio_url ?? undefined,
      audio_name: input.audio_name ?? undefined,
      audience: input.audience ?? 'everyone',
    });
    storage.setJSON(K_MINE, [story, ...(storage.getJSON<Story[]>(K_MINE) ?? [])]);
    warmMedia([story]);
    return story;
  },

  /** Modifie une de mes stories. */
  update(
    id: string,
    patch: Partial<Pick<Story, 'caption' | 'background_color' | 'font' | 'duration_sec'>>,
  ): Promise<Story> {
    return apiClient.patch<Story>(Endpoints.stories.byId(id), patch);
  },

  /** Supprime une de mes stories. Purge le cache local aussitôt. */
  async remove(id: string): Promise<void> {
    storage.setJSON(K_MINE, (storage.getJSON<Story[]>(K_MINE) ?? []).filter((s) => s.id !== id));
    await apiClient.delete(Endpoints.stories.byId(id));
  },

  /** Marque une story comme vue — met aussi à jour le cache local
   * (`seen_by_me`) pour que l'état survive hors-ligne. */
  markViewed(id: string): Promise<void> {
    const feed = storage.getJSON<StoryFeedItem[]>(K_FEED);
    if (feed) {
      let changed = false;
      for (const it of feed) {
        for (const s of it.stories) {
          if (s.id === id && !s.seen_by_me) {
            s.seen_by_me = true;
            changed = true;
          }
        }
        it.has_unseen = it.stories.some((s) => !s.seen_by_me);
      }
      if (changed) storage.setJSON(K_FEED, feed);
    }
    return apiClient.post(Endpoints.stories.view(id)).then(() => undefined).catch(() => undefined);
  },

  /** Spectateurs d'une de mes stories. */
  viewers(id: string): Promise<StoryViewer[]> {
    return apiClient.get<StoryViewer[]>(Endpoints.stories.viewers(id));
  },

  /** Réagit à une story (emoji), ou retire la réaction si `emoji` est null. */
  react(id: string, emoji: string | null): Promise<void> {
    if (emoji == null) {
      return apiClient.delete(Endpoints.stories.react(id)).then(() => undefined);
    }
    return apiClient.post(Endpoints.stories.react(id), { emoji }).then(() => undefined);
  },

  /** Répond à une story → crée un message dans la conversation avec l'auteur. */
  reply(id: string, body: string, clientId?: string): Promise<{ id: string; conversation_id: string }> {
    return apiClient.post(Endpoints.stories.reply(id), {
      body,
      client_id: clientId ?? undefined,
    });
  },
};
