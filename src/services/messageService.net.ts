/**
 * Accès réseau bruts aux messages — utilisés uniquement par le `syncEngine`
 * (push/pull). Les écrans passent par `messageService` (local-first).
 */
import { apiClient, Endpoints } from '@/api';
import {
  decryptMessageFromUser,
  type EncryptedPayload,
} from '@/crypto';
import type { ChatMessage } from '@/types';
import { E2EE_ENABLED } from '@/utils/constants';

export const messageService = {
  history(conversationId: string, page = 1, limit = 40): Promise<ChatMessage[]> {
    return apiClient.get<ChatMessage[]>(
      `${Endpoints.conversations.messages(conversationId)}?page=${page}&limit=${limit}`,
    );
  },

  since(conversationId: string, sinceIso: string): Promise<ChatMessage[]> {
    return apiClient.get<ChatMessage[]>(
      `${Endpoints.conversations.messages(conversationId)}?since=${encodeURIComponent(sinceIso)}`,
    );
  },

  /** Accusé de réception « remis » (double coche grise chez l'expéditeur). */
  ackDelivered(messageId: string): Promise<unknown> {
    return apiClient.post(Endpoints.messages.delivered(messageId)).catch(() => undefined);
  },

  /**
   * Tente de déchiffrer un blob brut (`body_cipher` conservé après un échec).
   * Retourne le texte clair, ou null si le déchiffrement échoue encore.
   */
  async tryDecryptCipher(senderId: string, cipher: string): Promise<string | null> {
    if (!E2EE_ENABLED) return null; // E2EE off : aucune tentative de reprise
    let payload: EncryptedPayload;
    try {
      payload = JSON.parse(cipher) as EncryptedPayload;
    } catch {
      return null;
    }
    try {
      return await decryptMessageFromUser(senderId, payload);
    } catch {
      return null;
    }
  },

  /** Déchiffre si nécessaire — ne lève jamais. */
  async decryptIfNeeded(msg: ChatMessage): Promise<ChatMessage> {
    if (!msg.encrypted || msg.decrypted) return msg;
    // Seul le TEXTE a jamais été chiffré : un vocal / média / position porte
    // son contenu dans `attachment_url` + `attachment_meta`, jamais dans
    // `body`. On ne doit donc jamais le marquer « indisponible » même si le
    // serveur a positionné `encrypted=true` sur la ligne.
    if (msg.type !== 'text') {
      return { ...msg, body: '', decrypted: true };
    }
    // E2EE désactivé : on ne tente pas — les textes chiffrés (anciens)
    // deviennent « indisponibles » (pas de clé, pas de tentative).
    if (!E2EE_ENABLED) {
      return { ...msg, body: '', decrypted: true, decryptFailed: true };
    }
    let payload: EncryptedPayload;
    try {
      payload = JSON.parse(msg.body) as EncryptedPayload;
    } catch (e) {
      console.warn(
        `[decrypt] msg ${msg.id} body n'est pas un JSON EncryptedPayload:`,
        String(msg.body).slice(0, 80),
        String(e),
      );
      return { ...msg, body: '', decrypted: true, decryptFailed: true };
    }
    try {
      const body = await decryptMessageFromUser(msg.sender_id, payload);
      return { ...msg, body, decrypted: true };
    } catch (e) {
      console.warn(
        `[decrypt] msg ${msg.id} de ${msg.sender_id} echec:`,
        `contentType=${payload.contentType}`,
        `senderDev=${payload.senderDeviceId}`,
        `hasX3DH=${!!payload.x3dhEphemeralPublicKey}`,
        `otpkId=${payload.x3dhOneTimePrekeyId}`,
        '->',
        String(e),
      );
      // Echec de dechiffrement : on NE stocke PAS de texte (body vide) pour ne
      // pas ecraser un eventuel texte clair deja present en local. Le flag
      // `decryptFailed` pilote l'affichage cote MessageBubble.
      return { ...msg, body: '', decrypted: true, decryptFailed: true };
    }
  },
};
