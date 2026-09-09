/**
 * Conversations — LOCAL-FIRST. Lecture depuis SQLite ; les changements
 * d'état (accepter/refuser une demande, sourdine) sont appliqués en local
 * puis empilés dans l'outbox.
 *
 * L'ouverture d'une NOUVELLE conversation nécessite le réseau (il faut l'id
 * serveur avant de pouvoir écrire dedans) — on tente, et on remonte l'erreur
 * si hors-ligne.
 */
import { apiClient, Endpoints } from '@/api';
import { conversationRepo } from '@/db/repositories/conversationRepo';
import { newClientId, outbox } from '@/sync/outbox';
import type { ConversationDetail, ConversationSummary } from '@/types';

export const conversationService = {
  list(): Promise<ConversationSummary[]> {
    return conversationRepo.list();
  },

  get(id: string): Promise<ConversationSummary | null> {
    return conversationRepo.get(id);
  },

  /**
   * Détail serveur d'une conversation (statut de demande, présence du
   * partenaire à jour). Réseau requis — l'appelant retombe sur `get()` local
   * en cas d'échec.
   */
  async detail(id: string): Promise<ConversationDetail> {
    const d = await apiClient.get<ConversationDetail>(Endpoints.conversations.detail(id));
    await conversationRepo.setRequestStatus(id, d.request_status);
    await conversationRepo.setMuted(id, d.muted);
    return d;
  },

  /** Réseau requis. Persiste la conversation créée en local. */
  async start(partnerId: string): Promise<ConversationDetail> {
    const detail = await apiClient.post<ConversationDetail>(Endpoints.conversations.start, {
      partner_id: partnerId,
    });
    await conversationRepo.upsertFromServer({
      id: detail.id,
      partner: detail.partner,
      last_message: null,
      last_message_type: null,
      last_message_at: null,
      last_message_encrypted: false,
      unread_count: 0,
      muted: detail.muted,
      request_status: detail.request_status,
    });
    return detail;
  },

  async accept(conversationId: string): Promise<void> {
    await conversationRepo.setRequestStatus(conversationId, 'accepted');
    await outbox.enqueue('accept_request', newClientId(), { conversationId });
  },

  async decline(conversationId: string): Promise<void> {
    await conversationRepo.setRequestStatus(conversationId, 'declined');
    await outbox.enqueue('decline_request', newClientId(), { conversationId });
  },

  async setMuted(conversationId: string, muted: boolean): Promise<void> {
    await conversationRepo.setMuted(conversationId, muted);
    await outbox.enqueue('mute', newClientId(), { conversationId, muted });
  },
};
