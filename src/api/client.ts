/**
 * Client HTTP minimal (fetch) — auth Bearer, refresh automatique sur 401,
 * retry réseau exponentiel, timeout 30 s. Aligné sur le backend E-discussion
 * (enveloppe d'erreur `{ detail: { code, message } }`).
 */
import { API_BASE_URL } from '@/utils/constants';

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

export const setAccessToken = (t: string | null) => {
  accessToken = t;
};
export const setRefreshFn = (fn: () => Promise<string>) => {
  refreshFn = fn;
};
export const setOnUnauthorized = (fn: () => void) => {
  onUnauthorized = fn;
};

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
