/**
 * Client HTTP minimal (fetch) — auth Bearer, refresh PROACTIF avant
 * expiration + refresh réactif de secours sur 401, retry réseau
 * exponentiel, timeout 30 s. Aligné sur le backend E-discussion (enveloppe
 * d'erreur `{ detail: { code, message } }`).
 *
 * Pourquoi un refresh proactif en plus du réactif-sur-401 : l'access token
 * dure 30 min (`ACCESS_TOKEN_EXPIRE_MINUTES` côté serveur) — sans rien de
 * plus, TOUTE requête émise après cette fenêtre part avec un token déjà
 * expiré, échoue en 401, puis retente après coup. En pratique ça se
 * produisait en RAFALE (plusieurs endpoints appelés en parallèle au retour
 * au premier plan/au démarrage) — chacun payait son propre aller-retour de
 * refresh au lieu d'un seul, partagé, déclenché EN AMONT. Le minuteur
 * ci-dessous rafraîchit quelques minutes avant l'échéance réelle du token,
 * façon WhatsApp (session qui ne "coupe" jamais en cours d'usage normal) —
 * le chemin réactif-sur-401 reste le filet de sécurité (réseau coupé
 * pendant la fenêtre proactive, minuteur JS gelé en arrière-plan, etc.).
 */
import { AppState, type AppStateStatus } from 'react-native';

import { API_BASE_URL } from '@/utils/constants';
import { decodeJwtExpiryMs } from '@/utils/jwt';

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public data?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface RequestOptions {
  method?: Method;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

let accessToken: string | null = null;
let refreshFn: (() => Promise<string>) | null = null;
let onUnauthorized: (() => void) | null = null;
let refreshPromise: Promise<string> | null = null;
let proactiveTimer: ReturnType<typeof setTimeout> | null = null;

// marge avant l'échéance réelle : on rafraîchit en avance pour absorber la
// latence réseau du refresh lui-même + l'horloge du device qui peut dériver
// un peu par rapport au serveur — jamais pile au moment où le token meurt.
const PROACTIVE_REFRESH_MARGIN_MS = 2 * 60_000;
// borne basse : si le token est déjà expiré/quasi expiré au moment où on le
// reçoit (horloge très décalée, refresh qui a traîné), on retente quand
// même après un court délai plutôt que d'appeler refreshAccessToken() en
// boucle synchrone.
const PROACTIVE_REFRESH_MIN_DELAY_MS = 5_000;

function clearProactiveTimer(): void {
  if (proactiveTimer) {
    clearTimeout(proactiveTimer);
    proactiveTimer = null;
  }
}


function scheduleProactiveRefresh(): void {
  clearProactiveTimer();
  if (!accessToken || !refreshFn) return;
  const expiryMs = decodeJwtExpiryMs(accessToken);
  if (expiryMs === null) return;
  const delay = Math.max(PROACTIVE_REFRESH_MIN_DELAY_MS, expiryMs - Date.now() - PROACTIVE_REFRESH_MARGIN_MS);
  proactiveTimer = setTimeout(() => {
    void refreshAccessToken();
  }, delay);
}

export const setAccessToken = (t: string | null) => {
  accessToken = t;
  if (t) scheduleProactiveRefresh();
  else clearProactiveTimer();
};
export const getAccessToken = () => accessToken;
export const setRefreshFn = (fn: () => Promise<string>) => {
  refreshFn = fn;
};
export const setOnUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

/** true si l'erreur signifie "le serveur a explicitement rejeté ce token"
 * (401/403 avec une vraie réponse) plutôt qu'une simple absence de réseau —
 * seule la première justifie une déconnexion. Sans cette distinction, TOUTE
 * coupure réseau pendant un refresh (mode avion, zone blanche...) renvoyait
 * l'utilisateur à l'écran de connexion alors que son cache local restait
 * parfaitement valide et exploitable (façon WhatsApp hors-ligne). */
function isAuthRejection(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401;
}

/** Rafraîchit le token d'accès à la demande — pour un chemin qui ne passe
 * PAS par `request()`/`upload()` (ex: authentification WebSocket), qui ne
 * bénéficie donc jamais du refresh réactif-sur-401 ci-dessous. Partage la
 * même `refreshPromise` (une seule requête de refresh en vol à la fois). */
export async function refreshAccessToken(): Promise<string | null> {
  if (!refreshFn) return null;
  try {
    refreshPromise ??= refreshFn().finally(() => {
      refreshPromise = null;
    });
    const fresh = await refreshPromise;
    setAccessToken(fresh); // reprogramme aussi le prochain refresh proactif
    return fresh;
  } catch (err) {
    // hors-ligne / timeout / erreur serveur transitoire (5xx) : on NE
    // déconnecte PAS — l'access token expiré reste en place, les requêtes
    // suivantes échoueront proprement et l'app continue sur son cache local
    // jusqu'au retour du réseau, où le refresh proactif reprendra tout seul.
    if (isAuthRejection(err)) onUnauthorized?.();
    return null;
  }
}

// Minuteur JS non fiable en arrière-plan (Android/iOS suspendent le JS) : au
// retour au premier plan, on vérifie l'échéance réelle du token et on
// rafraîchit tout de suite s'il est déjà expiré/sur le point de l'être —
// sans attendre qu'une requête échoue en 401 en premier.
AppState.addEventListener('change', (state: AppStateStatus) => {
  if (state !== 'active' || !accessToken) return;
  const expiryMs = decodeJwtExpiryMs(accessToken);
  if (expiryMs !== null && expiryMs - Date.now() <= PROACTIVE_REFRESH_MARGIN_MS) {
    void refreshAccessToken();
  }
});

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

function buildHeaders(locale: string, extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-Lang': locale,
    ...extra,
  };
  if (accessToken) h.Authorization = `Bearer ${accessToken}`;
  return h;
}

let currentLocale = 'fr';
export const setApiLocale = (l: string) => {
  currentLocale = l;
};

async function request<T>(
  endpoint: string,
  options: RequestOptions = {},
  isRetry = false,
  netAttempt = 0,
): Promise<T> {
  const { method = 'GET', body, headers, signal } = options;

  const timeoutCtrl = new AbortController();
  const timer = setTimeout(() => timeoutCtrl.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method,
      headers: buildHeaders(currentLocale, headers),
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: signal ?? timeoutCtrl.signal,
    });
    clearTimeout(timer);

    let json: any = null;
    if (res.status !== 204) {
      const text = await res.text();
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        if (!res.ok) throw new ApiError(res.status, `Erreur serveur (${res.status})`);
      }
    }

    if (res.status === 401 && !isRetry && refreshFn) {
      try {
        refreshPromise ??= refreshFn().finally(() => {
          refreshPromise = null;
        });
        const fresh = await refreshPromise;
        setAccessToken(fresh);
        return request<T>(endpoint, options, true);
      } catch (err) {
        // le refresh a échoué par manque de réseau (pas un vrai rejet
        // serveur) : ne pas déconnecter, remonter une erreur réseau normale
        // — l'appelant (souvent silencieux, best-effort) garde son cache.
        if (!isAuthRejection(err)) throw new ApiError(0, 'Erreur réseau');
        onUnauthorized?.();
        throw new ApiError(401, 'Session expirée', 'token_expired');
      }
    }

    if (!res.ok) {
      const detail = json?.detail;
      const message =
        typeof detail === 'string' ? detail : detail?.message ?? `Erreur ${res.status}`;
      const code = typeof detail === 'object' ? detail?.code : undefined;
      throw new ApiError(res.status, message, code, json);
    }

    return json as T;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ApiError) throw err;
    const isNetwork = (err as Error).name === 'AbortError' || err instanceof TypeError;
    if (isNetwork && !isRetry && netAttempt < MAX_RETRIES) {
      await new Promise<void>((r) => setTimeout(() => r(), 2 ** netAttempt * 500));
      return request<T>(endpoint, options, false, netAttempt + 1);
    }
    throw new ApiError(0, (err as Error).message || 'Erreur réseau');
  }
}

/** Fichier local a envoyer en multipart (issu d'un picker RN). */
export interface UploadFile {
  uri: string;
  name: string;
  type: string;
}

/**
 * Upload multipart/form-data. Ne passe pas par `request()` (qui force le JSON) :
 * on gere ici l'auth Bearer, le refresh 401 une fois, et un timeout allonge
 * (les videos peuvent etre lourdes).
 */
async function upload<T>(
  endpoint: string,
  file: UploadFile,
  field = 'file',
  isRetry = false,
): Promise<T> {
  const form = new FormData();
  // La forme { uri, name, type } est l'API React Native de FormData (pas web).
  form.append(field, { uri: file.uri, name: file.name, type: file.type } as unknown as Blob);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120_000);
  try {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'X-Lang': currentLocale,
    };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(`${API_BASE_URL}${endpoint}`, {
      method: 'POST',
      headers, // NB: pas de Content-Type -> fetch pose le boundary multipart
      body: form,
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    const text = res.status === 204 ? '' : await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* corps non-JSON */
    }

    if (res.status === 401 && !isRetry && refreshFn) {
      try {
        refreshPromise ??= refreshFn().finally(() => {
          refreshPromise = null;
        });
        const fresh = await refreshPromise;
        setAccessToken(fresh);
        return upload<T>(endpoint, file, field, true);
      } catch {
        onUnauthorized?.();
        throw new ApiError(401, 'Session expirée', 'token_expired');
      }
    }

    if (!res.ok) {
      const detail = json?.detail;
      const message =
        typeof detail === 'string' ? detail : detail?.message ?? `Erreur ${res.status}`;
      const code = typeof detail === 'object' ? detail?.code : undefined;
      throw new ApiError(res.status, message, code, json);
    }
    return json as T;
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof ApiError) throw err;
    throw new ApiError(0, (err as Error).message || 'Erreur réseau');
  }
}

export const apiClient = {
  get: <T>(e: string, o?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(e, { ...o, method: 'GET' }),
  post: <T>(e: string, body?: unknown, o?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(e, { ...o, method: 'POST', body }),
  put: <T>(e: string, body?: unknown, o?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(e, { ...o, method: 'PUT', body }),
  patch: <T>(e: string, body?: unknown, o?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(e, { ...o, method: 'PATCH', body }),
  delete: <T>(e: string, body?: unknown, o?: Omit<RequestOptions, 'method' | 'body'>) =>
    request<T>(e, { ...o, method: 'DELETE', body }),
  upload,
};
