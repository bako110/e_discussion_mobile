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

import { getAccessToken, refreshAccessToken } from '@/api/client';
import { WS_URL } from '@/utils/constants';

/** Code de fermeture envoyé par le serveur quand l'auth WS échoue (token
 * expiré/invalide) — voir `app/api/v1/routers/ws.py::websocket_endpoint`,
 * `ws.close(code=4401)`. */
const WS_CLOSE_UNAUTHORIZED = 4401;

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

// intervalles (ms)
const PING_NORMAL = 25_000;
const PING_KEEPALIVE = 8_000;
const PONG_TIMEOUT_NORMAL = 40_000;
const PONG_TIMEOUT_KEEPALIVE = 18_000;

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
  const needsTokenRefresh = useRef(false);

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
    // la dernière tentative a été rejetée pour auth (token expiré) — le WS
    // n'a aucune notion de 401/refresh réactif comme les requêtes REST
    // (`client.ts`), donc SANS cet appel explicite le même token périmé
    // était renvoyé indéfiniment (boucle de reconnexion toutes les ~30s,
    // jamais résolue tant qu'aucune requête HTTP ne rafraîchissait le token
    // par ailleurs).
    if (needsTokenRefresh.current) {
      needsTokenRefresh.current = false;
      await refreshAccessToken();
    }
    const token = getAccessToken();
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
        // socket prête juste après (re)connexion — signale l'état courant
        // de l'app pour que la présence "en ligne" reflète tout de suite
        // la réalité (pas seulement à partir du prochain changement AppState).
        if (AppState.currentState === 'active') {
          ws.send(JSON.stringify({ type: 'app.foreground' }));
        }
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

    ws.onclose = (ev) => {
      setConnected(false);
      if (pingTimer.current) clearInterval(pingTimer.current);
      if (pongWatchdog.current) clearInterval(pongWatchdog.current);
      if (ev.code === WS_CLOSE_UNAUTHORIZED) {
        needsTokenRefresh.current = true;
      }
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
      // en arrière-plan : on NE FERME rien — la socket vit tant que l'OS
      // laisse le process tourner (indispensable pendant un appel), MAIS on
      // signale explicitement l'état au serveur pour que la présence "en
      // ligne" reflète le premier plan réel, pas juste le process vivant
      // (un service natif Android maintient volontairement ce dernier en
      // arrière-plan pour les notifications/appels — voir ws.py côté backend).
      if (s !== 'active') {
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'app.background' }));
        }
        return;
      }
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        reconnectAttempt.current = 0;
        void connect();
        return;
      }
      // socket "ouverte" mais on revient de veille : ping immédiat + si pas
      // de pong on reconnecte (la socket a pu mourir en arrière-plan). Le
      // délai de grâce suit la MÊME politique que le watchdog normal
      // (keepAlive pendant un appel -> plus court mais pas agressif ; sinon
      // le seuil normal) — un délai fixe trop court (4s) déclenchait des
      // reconnexions forcées inutiles sur un réseau mobile qui vient de se
      // réveiller (latence initiale plus élevée), coupant le WS en pleine
      // acceptation d'appel depuis l'arrière-plan.
      const graceMs = keepAliveRef.current ? PONG_TIMEOUT_KEEPALIVE : PONG_TIMEOUT_NORMAL;
      lastPong.current = Date.now() - 1; // force le prochain check
      ws.send(JSON.stringify({ type: 'ping' }));
      ws.send(JSON.stringify({ type: 'app.foreground' }));
      setTimeout(() => {
        if (
          wsRef.current === ws &&
          ws.readyState === WebSocket.OPEN &&
          Date.now() - lastPong.current > graceMs
        ) {
          forceReconnect(ws, () => void connect());
        }
      }, graceMs);
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
