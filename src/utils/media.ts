import { API_BASE_URL } from '@/utils/constants';

/**
 * Résout une URL de média renvoyée par le backend.
 *
 * Le serveur renvoie des chemins relatifs (`/media/2026/09/xxx.jpg`) pour les
 * fichiers qu'il sert lui-même. On les préfixe avec l'hôte de l'API. Les URLs
 * déjà absolues (http/https, data:) sont laissées telles quelles.
 */
export function mediaUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  if (/^(https?:|data:|file:|content:)/.test(url)) return url;
  if (url.startsWith('/')) return `${API_BASE_URL}${url}`;
  return url;
}
