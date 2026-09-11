/**
 * Diffusion en direct d'une chaîne — SFU LiveKit auto-hébergé (le même que
 * les appels 1-1). Un admin de la chaîne démarre/arrête ; les abonnés
 * rejoignent en spectateurs (audio/vidéo lecture seule, jamais de
 * publication) — façon YouTube/Instagram Live.
 *
 * Toutes ces opérations EXIGENT le réseau (comme les appels) : pas de
 * local-first ici, l'appelant affiche « connexion requise » en cas d'échec.
 */
import { apiClient, Endpoints } from '@/api';
import type { ChannelLive, ChannelLiveJoin, ChannelLiveStart } from '@/types';

export const channelLiveService = {
  /** Chaînes auxquelles je suis abonné et qui diffusent EN DIRECT maintenant
   * — alimente la section « Chaînes en direct » de l'écran Stories. */
  listLive(): Promise<ChannelLive[]> {
    return apiClient.get<ChannelLive[]>(Endpoints.groups.liveList);
  },

  /** Session live en cours pour CETTE chaîne, ou `null` — pour le bouton
   * Démarrer/Rejoindre dans les réglages/l'info de la chaîne. */
  getForChannel(groupId: string): Promise<ChannelLive | null> {
    return apiClient.get<ChannelLive | null>(Endpoints.groups.live(groupId));
  },

  /** Démarre un direct (admin de la chaîne uniquement). */
  start(groupId: string, title?: string): Promise<ChannelLiveStart> {
    return apiClient.post<ChannelLiveStart>(Endpoints.groups.live(groupId), {
      title: title || undefined,
    });
  },

  /** Rejoint le direct en cours en SPECTATEUR (n'importe quel abonné). */
  join(groupId: string): Promise<ChannelLiveJoin> {
    return apiClient.post<ChannelLiveJoin>(Endpoints.groups.liveJoin(groupId));
  },

  /** Arrête le direct en cours (admin de la chaîne uniquement). */
  stop(groupId: string): Promise<ChannelLive> {
    return apiClient.post<ChannelLive>(Endpoints.groups.liveStop(groupId));
  },
};
