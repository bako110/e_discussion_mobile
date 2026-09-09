/**
 * Connexion WebSocket temps réel unique (/api/v1/ws). Auth par 1er message,
 * ping toutes les 25 s, reconnexion exponentielle. Les écrans s'abonnent aux
 * events via `addListener`.
 *
 * Events serveur : message.new/edited/deleted/reaction, receipt.delivered/read,
 * typing.start/stop, presence.update, auth.ok.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import * as Keychain from 'react-native-keychain';

import { WS_URL } from '@/utils/constants';

export interface WsEvent {
  type: string;
  [key: string]: unknown;
}
type Listener = (e: WsEvent) => void;

interface WsContextValue {
  connected: boolean;
  send: (payload: object) => void;
  addListener: (fn: Listener) => () => void;
  sendTyping: (conversationId: string, state: 'start' | 'stop') => void;
}

const WsContext = createContext<WsContextValue | null>(null);

const KEYCHAIN_SERVICE = 'ediscussion-auth-tokens';

async function currentAccessToken(): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!creds || !creds.password) return null;
    return (JSON.parse(creds.password) as { access: string }).access ?? null;
  } catch {
    return null;
  }
}

export const WebSocketProvider: React.FC<{ enabled: boolean; children: React.ReactNode }> = ({
  enabled,
  children,
}) => {
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const listeners = useRef<Set<Listener>>(new Set());
  const reconnectAttempt = useRef(0);
  const pingTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  const cleanup = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    pingTimer.current = null;
    reconnectTimer.current = null;
  }, []);

  const connect = useCallback(async () => {
    if (!enabled) return;
    const token = await currentAccessToken();
    if (!token) {
      console.warn('[ws] pas de token access — connexion differee');
      return;
    }

    closedByUs.current = false;
    console.log('[ws] connexion ->', WS_URL);
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[ws] socket ouverte, envoi auth');
      ws.send(JSON.stringify({ type: 'auth', token }));
    };

    ws.onmessage = (ev) => {
      let data: WsEvent;
      try {
        data = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      if (data.type === 'auth.ok') {
        console.log('[ws] auth.ok — connecte');
        setConnected(true);
        reconnectAttempt.current = 0;
        return;
      }
      if (data.type === 'pong') return;
      console.log('[ws] event recu:', data.type);
      listeners.current.forEach((fn) => fn(data));
    };

    ws.onclose = (ev) => {
      console.warn(`[ws] fermeture code=${(ev as { code?: number }).code} reason=${(ev as { reason?: string }).reason}`);
      setConnected(false);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (!closedByUs.current && enabled) {
        const delay = Math.min(30_000, 2 ** reconnectAttempt.current * 1000);
        reconnectAttempt.current += 1;
        console.log(`[ws] reconnexion dans ${delay}ms (tentative ${reconnectAttempt.current})`);
        reconnectTimer.current = setTimeout(() => void connect(), delay);
      }
    };

    ws.onerror = (e) => {
      console.warn('[ws] erreur:', (e as { message?: string }).message ?? 'inconnue');
      ws.close();
    };

    pingTimer.current = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'ping' }));
    }, 25_000);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      closedByUs.current = true;
      wsRef.current?.close();
      cleanup();
      setConnected(false);
      return;
    }
    void connect();

    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s === 'active' && wsRef.current?.readyState !== WebSocket.OPEN) {
        reconnectAttempt.current = 0;
        void connect();
      }
    });

    return () => {
      sub.remove();
      closedByUs.current = true;
      wsRef.current?.close();
      cleanup();
    };
  }, [enabled, connect, cleanup]);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const addListener = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const sendTyping = useCallback(
    (conversationId: string, state: 'start' | 'stop') => {
      send({ type: 'typing', conversation_id: conversationId, state });
    },
    [send],
  );

  const value = useMemo(
    () => ({ connected, send, addListener, sendTyping }),
    [connected, send, addListener, sendTyping],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
};

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWs must be used within WebSocketProvider');
  return ctx;
}
