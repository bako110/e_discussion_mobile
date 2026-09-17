/**
 * Appels WebRTC — SFU LiveKit auto-hébergé (PAS LiveKit Cloud).
 *
 * Le backend ne fait que : signer les tokens d'accès aux rooms, relayer la
 * sonnerie via WebSocket, historiser l'appel. Le média transite par le
 * serveur LiveKit du VPS.
 *
 * Chiffrement bout-en-bout : la clé E2EE est générée ICI par l'appelant
 * (`generateE2eeKey`), transmise au destinataire dans l'event WS
 * `call.incoming`. Le serveur ne l'utilise ni ne la journalise.
 */
import { apiClient, Endpoints } from '@/api';
import { randomBytes, toBase64 } from '@/crypto/primitives';
import { storage } from '@/utils/storage';
import type { CallLog, CallRating, CallsConfig, CallStart, CallToken, CallType } from '@/types';

const K_HISTORY = 'calls.history.cache';

export const callService = {
  /** Génère une clé E2EE aléatoire (256 bits, base64) pour un nouvel appel. */
  generateE2eeKey(): string {
    return toBase64(randomBytes(32));
  },

  /** Indique si les appels sont disponibles (SFU configuré côté serveur). */
  config(): Promise<CallsConfig> {
    return apiClient.get<CallsConfig>(Endpoints.calls.config);
  },

  /** Historique local (cache MMKV) — instantané, hors-ligne OK. */
  readHistoryCache(): CallLog[] {
    return storage.getJSON<CallLog[]>(K_HISTORY) ?? [];
  },

  /**
   * Historique d'appels (paginé). Seule la page 1 réécrit le cache local
   * MMKV (source affichée hors-ligne / au tout premier rendu) — les pages
   * suivantes (scroll infini) ne sont gardées qu'en mémoire côté écran, pour
   * ne pas faire grossir indéfiniment le cache instantané ni le désynchroniser
   * d'une suppression/rafraîchissement fait entre-temps sur la page 1.
   */
  async history(page = 1, limit = 40): Promise<CallLog[]> {
    const logs = await apiClient.get<CallLog[]>(
      `${Endpoints.calls.history}?page=${page}&limit=${limit}`,
    );
    if (page === 1) storage.setJSON(K_HISTORY, logs);
    return logs;
  },

  /** Retire une entrée du cache local (suppression optimiste). */
  removeFromCache(callId: string): void {
    storage.setJSON(K_HISTORY, callService.readHistoryCache().filter((l) => l.id !== callId));
  },
  clearCache(): void {
    storage.setJSON(K_HISTORY, []);
  },

  /**
   * Démarre un appel : crée la room, fait sonner le destinataire, renvoie le
   * token LiveKit de l'appelant + l'URL du SFU.
   */
  start(calleeId: string, callType: CallType, e2eeKey: string | null): Promise<CallStart> {
    return apiClient.post<CallStart>(Endpoints.calls.start, {
      callee_id: calleeId,
      call_type: callType,
      e2ee_key: e2eeKey,
    });
  },

  /** Le destinataire accepte : renvoie SON token LiveKit pour rejoindre. */
  accept(callId: string): Promise<CallToken> {
    return apiClient.post<CallToken>(Endpoints.calls.accept(callId));
  },

  /** Le destinataire refuse la sonnerie (`reason: 'busy'` si déjà en ligne). */
  reject(callId: string, reason?: 'busy' | 'declined'): Promise<CallLog> {
    return apiClient.post<CallLog>(Endpoints.calls.reject(callId, reason));
  },

  /** Clôt de force tout appel « en cours » resté fantôme (récup après crash). */
  clearStuck(): Promise<{ message: string }> {
    return apiClient.post<{ message: string }>(Endpoints.calls.clearStuck);
  },

  /** L'appelant annule avant que ça décroche. */
  cancel(callId: string): Promise<CallLog> {
    return apiClient.post<CallLog>(Endpoints.calls.cancel(callId));
  },

  /** Un des deux participants raccroche un appel en cours. */
  hangup(callId: string): Promise<CallLog> {
    return apiClient.post<CallLog>(Endpoints.calls.hangup(callId));
  },

  /** Note de l'appel (1-5, obligatoire) + note de l'app (1-5, facultative),
   * proposées occasionnellement après un appel connecté. */
  rate(callId: string, callScore: number, appScore?: number | null, comment?: string): Promise<CallRating> {
    return apiClient.post<CallRating>(Endpoints.calls.rating(callId), {
      call_score: callScore,
      app_score: appScore ?? null,
      comment: comment ?? null,
    });
  },

  /** Supprime une entrée d'historique (cache local + serveur). */
  async remove(callId: string): Promise<{ message: string }> {
    callService.removeFromCache(callId);
    return apiClient.delete<{ message: string }>(Endpoints.calls.byId(callId));
  },

  /** Vide tout l'historique d'appels (cache local + serveur). */
  async clear(): Promise<{ message: string }> {
    callService.clearCache();
    return apiClient.delete<{ message: string }>(Endpoints.calls.clear);
  },
};
