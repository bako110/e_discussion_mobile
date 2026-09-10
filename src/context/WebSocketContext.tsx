/**
 * Connexion WebSocket temps réel unique (/api/v1/ws). Auth par 1er message.
 * Les écrans s'abonnent aux events via `addListener`.
 *
 * Résilience :
 *  - ping périodique + watchdog sur le `pong` (détecte les sockets « half-open »)
 *  - reconnexion exponentielle en temps normal ; INSTANTANÉE en mode keep-alive
 *  - reconnexion immédiate au retour du réseau (NetInfo)
 *  - `keepAlive(true)` pendant un appel : ping 8 s, watchdog 18 s, reconnexion
 *    sans délai, et on NE ferme JAMAIS la socket sur passage en arrière-plan.
 *
 * Events serveur : message.*, receipt.*, typing.*, presence.update,
 * call.incoming/accepted/rejected/cancelled/ended, auth.ok.
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
import NetInfo from '@react-native-community/netinfo';
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
  sendTyping: (
    conversationId: string,
    state: 'start' | 'stop',
    activity?: 'text' | 'audio',
  ) => void;
  /** Active le mode « ne jamais lâcher » (à appeler pendant un appel). */
  keepAlive: (on: boolean) => void;
}

const WsContext = createContext<WsContextValue | null>(null);

const KEYCHAIN_SERVICE = 'ediscussion-auth-tokens';

// intervalles (ms)
const PING_NORMAL = 25_000;
const PING_KEEPALIVE = 8_000;
const PONG_TIMEOUT_NORMAL = 40_000;
const PONG_TIMEOUT_KEEPALIVE = 18_000;

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
  const pongWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);
  const keepAliveRef = useRef(false);
  const lastPong = useRef(Date.now());

  const clearTimers = useCallback(() => {
    if (pingTimer.current) clearInterval(pingTimer.current);
    if (pongWatchdog.current) clearInterval(pongWatchdog.current);
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
    pingTimer.current = null;
    pongWatchdog.current = null;
    reconnectTimer.current = null;
  }, []);

  const scheduleReconnect = useCallback(
    (connectFn: () => void) => {
      if (reconnectTimer.current || closedByUs.current || !enabled) return;
      const delay = keepAliveRef.current
        ? 0 // pendant un appel : on ne perd pas une seconde
        : Math.min(30_000, 2 ** reconnectAttempt.current * 1000);
      reconnectAttempt.current += 1;
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connectFn();
      }, delay);
    },
    [enabled],
  );

  const forceReconnect = useCallback(
    (ws: WebSocket, connectFn: () => void) => {
      try {
        closedByUs.current = false;
        ws.close();
      } catch {
        /* ignore */
      }
      scheduleReconnect(connectFn);
    },
    [scheduleReconnect],
  );

  const armHeartbeat = useCallback(
    (ws: WebSocket, connectFn: () => void) => {
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (pongWatchdog.current) clearInterval(pongWatchdog.current);
      lastPong.current = Date.now();

      const pingMs = keepAliveRef.current ? PING_KEEPALIVE : PING_NORMAL;
      const pongTimeout = keepAliveRef.current
        ? PONG_TIMEOUT_KEEPALIVE
        : PONG_TIMEOUT_NORMAL;

      // 1) ping régulier
      pingTimer.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'ping' }));
        } else if (ws.readyState === WebSocket.CLOSED) {
          forceReconnect(ws, connectFn);
        }
      }, pingMs);

      // 2) watchdog INDÉPENDANT : vérifie le dernier pong toutes les ~3 s.
      //    Si la socket est « half-open » (ni close, ni pong), on reconnecte.
      pongWatchdog.current = setInterval(() => {
        if (closedByUs.current) return;
        if (Date.now() - lastPong.current > pongTimeout) {
          console.warn('[ws] pong manquant -> reconnexion');
          forceReconnect(ws, connectFn);
        }
      }, 3_000);
    },
    [forceReconnect],
  );

  const connect = useCallback(async () => {
    if (!enabled) return;
    // évite les connexions concurrentes
    if (
      wsRef.current &&
      (wsRef.current.readyState === WebSocket.CONNECTING ||
        wsRef.current.readyState === WebSocket.OPEN)
    ) {
      return;
    }
    const token = await currentAccessToken();
    if (!token) {
      console.warn('[ws] pas de token access — connexion differee');
      return;
    }

    closedByUs.current = false;
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
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
        console.warn('[ws] auth.ok — socket active');
        setConnected(true);
        reconnectAttempt.current = 0;
        lastPong.current = Date.now();
        return;
      }
      if (data.type === 'pong') {
        lastPong.current = Date.now();
        return;
      }
      if (data.type === 'message.new') {
        console.warn(
          `[ws] RX message.new -> ${listeners.current.size} listener(s)`,
        );
      }
      listeners.current.forEach((fn) => fn(data));
    };

    ws.onclose = () => {
      setConnected(false);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (pongWatchdog.current) clearInterval(pongWatchdog.current);
      if (!closedByUs.current && enabled) {
        scheduleReconnect(() => void connect());
      }
    };

    ws.onerror = () => {
      try {
        ws.close();
      } catch {
        /* ignore */
      }
    };

    armHeartbeat(ws, () => void connect());
  }, [enabled, armHeartbeat, scheduleReconnect]);

  // (re)connexion + réactions AppState / réseau
  useEffect(() => {
    if (!enabled) {
      closedByUs.current = true;
      wsRef.current?.close();
      clearTimers();
      setConnected(false);
      return;
    }
    void connect();

    const appSub = AppState.addEventListener('change', (s: AppStateStatus) => {
      if (s !== 'active') return;
      // en arrière-plan : on NE ferme rien — la socket vit tant que l'OS
      // laisse le process tourner (indispensable pendant un appel).
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectAttempt.current = 0;
        void connect();
        return;
      }
      // socket "ouverte" mais on revient de veille : ping immédiat + si pas
      // de pong dans 4 s on reconnecte (la socket a pu mourir en arrière-plan).
      lastPong.current = Date.now() - 1; // force le prochain check
      ws.send(JSON.stringify({ type: 'ping' }));
      setTimeout(() => {
        if (
          wsRef.current === ws &&
          ws.readyState === WebSocket.OPEN &&
          Date.now() - lastPong.current > 4_000
        ) {
          forceReconnect(ws, () => void connect());
        }
      }, 4_000);
    });

    const netSub = NetInfo.addEventListener((state) => {
      if (
        state.isConnected &&
        wsRef.current?.readyState !== WebSocket.OPEN &&
        wsRef.current?.readyState !== WebSocket.CONNECTING
      ) {
        reconnectAttempt.current = 0;
        void connect();
      }
    });

    return () => {
      appSub.remove();
      netSub();
      closedByUs.current = true;
      wsRef.current?.close();
      clearTimers();
    };
  }, [enabled, connect, clearTimers, forceReconnect]);

  const send = useCallback((payload: object) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }, []);

  const addListener = useCallback((fn: Listener) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const sendTyping = useCallback(
    (conversationId: string, state: 'start' | 'stop', activity: 'text' | 'audio' = 'text') => {
      send({ type: 'typing', conversation_id: conversationId, state, activity });
    },
    [send],
  );

  const keepAlive = useCallback(
    (on: boolean) => {
      if (keepAliveRef.current === on) return;
      keepAliveRef.current = on;
      // ré-arme le heartbeat au nouveau rythme, et reconnecte tout de suite
      // si la socket n'est pas ouverte.
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        armHeartbeat(ws, () => void connect());
      } else if (on) {
        reconnectAttempt.current = 0;
        void connect();
      }
    },
    [armHeartbeat, connect],
  );

  const value = useMemo(
    () => ({ connected, send, addListener, sendTyping, keepAlive }),
    [connected, send, addListener, sendTyping, keepAlive],
  );

  return <WsContext.Provider value={value}>{children}</WsContext.Provider>;
};

export function useWs(): WsContextValue {
  const ctx = useContext(WsContext);
  if (!ctx) throw new Error('useWs must be used within WebSocketProvider');
  return ctx;
}
