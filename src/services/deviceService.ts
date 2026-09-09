import { apiClient, Endpoints } from '@/api';
import { getDeviceId } from '@/crypto';
import type { LinkedDevice } from '@/types';

/**
 * Appareils liés au compte (E2E). L'appareil courant est identifié via
 * l'en-tête `X-Device-Id` (le backend marque `is_current`).
 */
export const deviceService = {
  async list(): Promise<LinkedDevice[]> {
    let headers: Record<string, string> | undefined;
    try {
      headers = { 'X-Device-Id': await getDeviceId() };
    } catch {
      /* identité pas encore prête */
    }
    return apiClient.get<LinkedDevice[]>(Endpoints.devices.mine, { headers });
  },

  /** Révoque un appareil : ses clés sont invalidées, il ne pourra plus
   * déchiffrer les nouveaux messages tant qu'il ne se ré-enregistre pas. */
  revoke(deviceId: string): Promise<void> {
    return apiClient.delete(Endpoints.devices.revoke(deviceId)).then(() => undefined);
  },
};
