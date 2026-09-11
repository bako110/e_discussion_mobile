import { apiClient, Endpoints, type UploadFile } from '@/api';
import { storage } from '@/utils/storage';
import { mediaCache } from '@/services/mediaCache';
import { newClientId, outbox } from '@/sync/outbox';
import type {
  CreateStoryInput,
  Story,
  StoryFeedItem,
  StoryViewer,
} from '@/types';

export type StoryAudienceMode = 'contacts' | 'contacts_except' | 'only';
export interface StoryAudience {
  mode: StoryAudienceMode;
  contact_ids: string[];
}

const K_AUDIENCE = 'stories.audience.cache';

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

  /**
   * Publie une story SANS média (texte) — LOCAL-FIRST comme un message :
   * une story ⏱ « en attente » apparaît tout de suite dans « Mes statuts »,
   * la publication réelle part par l'outbox et se rejoue au retour du
   * réseau. Ne lève jamais pour une raison réseau.
   */
  createText(input: CreateStoryInput): Story {
    const clientId = newClientId();
    const now = new Date().toISOString();
    const pending: Story = {
      id: `local:${clientId}`,
      client_id: clientId,
      author_id: '',
      media_type: input.media_type ?? 'text',
      media_url: input.media_url ?? null,
      caption: input.caption ?? null,
      background_color: input.background_color ?? null,
      font: input.font ?? null,
      duration_sec: input.duration_sec ?? 5,
      thumbnail_url: input.thumbnail_url ?? null,
      audio_url: input.audio_url ?? null,
      audio_name: input.audio_name ?? null,
      audience: (input.audience as Story['audience']) ?? 'everyone',
      created_at: now,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      edited_at: null,
      view_count: 0,
      reaction_count: 0,
      seen_by_me: true,
      my_reaction: null,
      is_mine: true,
      pending: true,
    };
    storage.setJSON(K_MINE, [pending, ...(storage.getJSON<Story[]>(K_MINE) ?? [])]);
    void outbox.enqueue('create_story', clientId, {
      client_id: clientId,
      media_type: pending.media_type,
      caption: pending.caption ?? undefined,
      background_color: pending.background_color ?? undefined,
      font: pending.font ?? undefined,
      duration_sec: pending.duration_sec,
      audience: pending.audience,
    });
    return pending;
  },

  /**
   * Publie une story AVEC média local (photo/vidéo/audio) — LOCAL-FIRST :
   * l'upload ET la publication sont différés dans l'outbox (rejoués au
   * retour du réseau, avec retry automatique). `localFile` sert d'aperçu
   * immédiat (miniature) tant que le média n'est pas encore sur le serveur.
   */
  createMedia(input: CreateStoryInput, localFile: UploadFile): Story {
    const clientId = newClientId();
    const now = new Date().toISOString();
    const pending: Story = {
      id: `local:${clientId}`,
      client_id: clientId,
      author_id: '',
      media_type: input.media_type ?? 'image',
      media_url: localFile.uri, // aperçu local en attendant l'upload
      caption: input.caption ?? null,
      background_color: input.background_color ?? null,
      font: input.font ?? null,
      duration_sec: input.duration_sec ?? 5,
      thumbnail_url: input.thumbnail_url ?? localFile.uri,
      audio_url: input.audio_url ?? null,
      audio_name: input.audio_name ?? null,
      audience: (input.audience as Story['audience']) ?? 'everyone',
      created_at: now,
      expires_at: new Date(Date.now() + 24 * 3600_000).toISOString(),
      edited_at: null,
      view_count: 0,
      reaction_count: 0,
      seen_by_me: true,
      my_reaction: null,
      is_mine: true,
      pending: true,
    };
    storage.setJSON(K_MINE, [pending, ...(storage.getJSON<Story[]>(K_MINE) ?? [])]);
    void outbox.enqueue('upload_story', clientId, {
      client_id: clientId,
      localFile,
      media_type: pending.media_type,
      caption: pending.caption ?? undefined,
      background_color: pending.background_color ?? undefined,
      audience: pending.audience,
      duration_sec: pending.duration_sec,
      isAudio: pending.media_type === 'audio',
    });
    return pending;
  },

  /** Retire une story locale « en attente » du cache (rejeu réussi ou annulé). */
  removePendingLocal(clientId: string): void {
    const list = storage.getJSON<Story[]>(K_MINE) ?? [];
    storage.setJSON(
      K_MINE,
      list.filter((s) => s.client_id !== clientId),
    );
  },

  /** Remplace une story locale « en attente » par la version confirmée serveur. */
  confirmPendingLocal(clientId: string, saved: Story): void {
    const list = storage.getJSON<Story[]>(K_MINE) ?? [];
    const idx = list.findIndex((s) => s.client_id === clientId);
    if (idx === -1) {
      storage.setJSON(K_MINE, [saved, ...list]);
    } else {
      list[idx] = saved;
      storage.setJSON(K_MINE, list);
    }
    warmMedia([saved]);
  },

  /** Marque une story locale « en attente » comme définitivement échouée. */
  markPendingFailedLocal(clientId: string): void {
    const list = storage.getJSON<Story[]>(K_MINE) ?? [];
    const idx = list.findIndex((s) => s.client_id === clientId);
    if (idx !== -1) {
      list[idx] = { ...list[idx]!, pending: false, failed: true };
      storage.setJSON(K_MINE, list);
    }
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

  // ── confidentialité des statuts (façon WhatsApp) ─────────────────────
  /** Lecture immédiate depuis le cache (peut être vide au 1er lancement). */
  readAudienceCache(): StoryAudience {
    return (
      storage.getJSON<StoryAudience>(K_AUDIENCE) ?? { mode: 'contacts', contact_ids: [] }
    );
  },

  /** Récupère la config serveur et met à jour le cache. */
  async audience(): Promise<StoryAudience> {
    const a = await apiClient.get<StoryAudience>(Endpoints.stories.audience);
    storage.setJSON(K_AUDIENCE, a);
    return a;
  },

  /**
   * Change la confidentialité des statuts — LOCAL-FIRST : on écrit le cache
   * tout de suite, l'appel serveur est rejoué par l'outbox à la reconnexion.
   */
  async setAudience(next: StoryAudience): Promise<void> {
    const clean: StoryAudience = {
      mode: next.mode,
      contact_ids: next.mode === 'contacts' ? [] : [...new Set(next.contact_ids)],
    };
    storage.setJSON(K_AUDIENCE, clean);
    await outbox.enqueue('update_story_audience', newClientId(), {
      mode: clean.mode,
      contact_ids: clean.contact_ids,
    });
  },
};
