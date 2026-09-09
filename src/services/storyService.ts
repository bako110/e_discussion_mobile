import { apiClient, Endpoints } from '@/api';
import type {
  CreateStoryInput,
  Story,
  StoryFeedItem,
  StoryViewer,
} from '@/types';

/**
 * Stories — statuts éphémères (24h). En ligne uniquement (pas d'offline-first
 * pour l'instant : une story se consulte quand on a du réseau).
 */
export const storyService = {
  /** Feed des contacts, groupé par auteur. */
  feed(): Promise<StoryFeedItem[]> {
    return apiClient.get<StoryFeedItem[]>(Endpoints.stories.feed);
  },

  /** Mes stories actives. */
  mine(): Promise<Story[]> {
    return apiClient.get<Story[]>(Endpoints.stories.mine);
  },

  /** Publie une story. */
  create(input: CreateStoryInput): Promise<Story> {
    return apiClient.post<Story>(Endpoints.stories.create, {
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
  },

  /** Modifie une de mes stories. */
  update(
    id: string,
    patch: Partial<Pick<Story, 'caption' | 'background_color' | 'font' | 'duration_sec'>>,
  ): Promise<Story> {
    return apiClient.patch<Story>(Endpoints.stories.byId(id), patch);
  },

  /** Supprime une de mes stories. */
  remove(id: string): Promise<void> {
    return apiClient.delete(Endpoints.stories.byId(id)).then(() => undefined);
  },

  /** Marque une story comme vue. */
  markViewed(id: string): Promise<void> {
    return apiClient.post(Endpoints.stories.view(id)).then(() => undefined);
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
