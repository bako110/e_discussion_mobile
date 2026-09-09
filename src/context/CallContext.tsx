/**
 * Orchestration des appels WebRTC — SFU LiveKit auto-hébergé (PAS LiveKit Cloud).
 *
 * Rôle :
 *  - écoute les events WS (`call.incoming/accepted/rejected/cancelled/ended`) ;
 *  - expose l'état d'appel courant + les actions (appeler, accepter, refuser,
 *    raccrocher, mute, haut-parleur, bascule caméra) ;
 *  - connecte / déconnecte la `Room` LiveKit avec chiffrement bout-en-bout
 *    (insertable streams via `RNKeyProvider`), la clé E2EE ne quittant jamais
 *    le canal chiffré du WS.
 *
 * Le rendu (écran entrant / écran actif) est piloté par le RootNavigator qui
 * lit `useCall()`.
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
import { Platform } from 'react-native';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RNE2EEManager,
  RNKeyProvider,
  registerGlobals,
} from '@livekit/react-native';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';

import { useAuth } from '@/context/AuthContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { callService } from '@/services';
import {
  clearIncomingCall,
  displayIncomingCall,
  ensureNotificationSetup,
  onNotificationAction,
} from '@/services/notificationService';
import { takePendingAcceptCallId } from '@/services/notificationBackground';
import type { CallType, UserPublic } from '@/types';

// LiveKit exige registerGlobals() une seule fois, avant toute Room.
let _globalsReady = false;
function ensureGlobals() {
  if (_globalsReady) return;
  registerGlobals();
  _globalsReady = true;
}

export type CallPhase =
  | 'idle'
  | 'outgoing' // on appelle, ça sonne chez l'autre
  | 'incoming' // on reçoit un appel qui sonne
  | 'connecting' // accepté, on rejoint la room
  | 'active' // média établi
  | 'ended'; // court instant avant retour à idle

export interface ActiveCall {
  callId: string;
  roomName: string;
  callType: CallType;
  peer: UserPublic | null;
  /** true = c'est nous qui avons initié l'appel. */
  outgoing: boolean;
  /** clé E2EE base64 (générée localement si outgoing, reçue via WS sinon). */
  e2eeKey: string | null;
}

interface CallContextValue {
  phase: CallPhase;
  call: ActiveCall | null;
  room: Room | null;
  /** secondes écoulées depuis la connexion média (0 hors appel actif). */
  elapsed: number;
  muted: boolean;
  speaker: boolean;
  cameraEnabled: boolean;
  /** true si le SFU est configuré côté serveur. */
  available: boolean;

  startCall: (callee: UserPublic, type: CallType) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  /** Bascule l'appel voix <-> vidéo à chaud (publie / retire la caméra). */
  setVideo: (enabled: boolean) => Promise<void>;
}

const CallContext = createContext<CallContextValue | null>(null);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { me } = useAuth();
  const { addListener } = useWs();

  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [call, setCall] = useState<ActiveCall | null>(null);
  const [room, setRoom] = useState<Room | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speaker, setSpeaker] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);

  const roomRef = useRef<Room | null>(null);
  const e2eeMgrRef = useRef<RNE2EEManager | null>(null);
  const keyProviderRef = useRef<RNKeyProvider | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const callRef = useRef<ActiveCall | null>(null);
  const phaseRef = useRef<CallPhase>('idle');
  // callId à accepter automatiquement (bouton "Répondre" de la notif, app tuée)
  const pendingAcceptRef = useRef<string | null>(takePendingAcceptCallId());
  const acceptCallRef = useRef<(() => Promise<void>) | null>(null);

  callRef.current = call;
  phaseRef.current = phase;

  // ── disponibilité (config serveur) + setup notifications ─────────────
  useEffect(() => {
    let alive = true;
    if (!me) {
      setAvailable(false);
      return;
    }
    void ensureNotificationSetup();
    callService
      .config()
      .then((cfg) => {
        if (alive) setAvailable(cfg.enabled);
      })
      .catch(() => {
        if (alive) setAvailable(false);
      });
    return () => {
      alive = false;
    };
  }, [me]);

  // ── nettoyage complet ────────────────────────────────────────────────
  const teardown = useCallback(async () => {
    if (tickRef.current) {
      clearInterval(tickRef.current);
      tickRef.current = null;
    }
    setElapsed(0);
    setMuted(false);
    setSpeaker(false);
    setCameraEnabled(false);

    const r = roomRef.current;
    roomRef.current = null;
    setRoom(null);
    if (r) {
      try {
        await r.disconnect();
      } catch {
        /* ignore */
      }
    }
    try {
      keyProviderRef.current?.dispose();
    } catch {
      /* ignore */
    }
    keyProviderRef.current = null;
    e2eeMgrRef.current = null;

    try {
      await AudioSession.stopAudioSession();
    } catch {
      /* ignore */
    }
  }, []);

  const resetToIdle = useCallback(() => {
    setPhase('ended');
    setCall(null);
    // petit délai pour laisser l'UI afficher "Appel terminé"
    setTimeout(() => {
      setPhase((p) => (p === 'ended' ? 'idle' : p));
    }, 1200);
  }, []);

  // ── connexion à la room LiveKit ──────────────────────────────────────
  const connectRoom = useCallback(
    async (opts: {
      livekitUrl: string;
      token: string;
      e2eeKey: string | null;
      callType: CallType;
    }) => {
      ensureGlobals();
      await AudioSession.configureAudio({
        android: {
          preferredOutputList: opts.callType === 'video' ? ['speaker'] : ['earpiece', 'bluetooth', 'headset'],
          audioTypeOptions: AndroidAudioTypePresets.communication,
        },
        ios: {
          defaultOutput: opts.callType === 'video' ? 'speaker' : 'earpiece',
        },
      });
      await AudioSession.startAudioSession();

      // E2EE : insertable streams. La clé vient du canal chiffré du WS —
      // le serveur ne la voit jamais.
      let e2eeManager: RNE2EEManager | undefined;
      if (opts.e2eeKey) {
        const keyProvider = new RNKeyProvider({ sharedKey: true });
        await keyProvider.setSharedKey(opts.e2eeKey);
        e2eeManager = new RNE2EEManager(keyProvider);
        keyProviderRef.current = keyProvider;
        e2eeMgrRef.current = e2eeManager;
      }

      const r = new Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: e2eeManager ? { e2eeManager } : undefined,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
      });

      r.on(RoomEvent.Disconnected, () => {
        void teardown();
        resetToIdle();
      });
      r.on(RoomEvent.ParticipantDisconnected, () => {
        // 1-to-1 : si l'autre part, on raccroche
        if (phaseRef.current === 'active' || phaseRef.current === 'connecting') {
          const c = callRef.current;
          if (c) void callService.hangup(c.callId).catch(() => undefined);
          void teardown();
          resetToIdle();
        }
      });
      r.on(RoomEvent.ConnectionStateChanged, () => {
        // no-op : on s'appuie sur Connected/Disconnected
      });

      roomRef.current = r;
      setRoom(r);

      if (opts.e2eeKey) {
        await r.setE2EEEnabled(true);
      }
      await r.connect(opts.livekitUrl, opts.token);

      await r.localParticipant.setMicrophoneEnabled(true);
      if (opts.callType === 'video') {
        await r.localParticipant.setCameraEnabled(true);
        setCameraEnabled(true);
        setSpeaker(true);
      }

      setPhase('active');
      // chrono
      const startedAt = Date.now();
      tickRef.current = setInterval(() => {
        setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      }, 1000);
    },
    [teardown, resetToIdle],
  );

  // ── actions publiques ────────────────────────────────────────────────
  const startCall = useCallback(
    async (callee: UserPublic, type: CallType) => {
      if (phaseRef.current !== 'idle') return;
      const e2eeKey = callService.generateE2eeKey();
      setPhase('outgoing');
      setCall({
        callId: 'pending',
        roomName: '',
        callType: type,
        peer: callee,
        outgoing: true,
        e2eeKey,
      });
      try {
        const res = await callService.start(callee.id, type, e2eeKey);
        setCall({
          callId: res.id,
          roomName: res.room_name,
          callType: type,
          peer: res.peer ?? callee,
          outgoing: true,
          e2eeKey,
        });
        // on rejoint la room tout de suite (l'appelant attend dans la room)
        setPhase('connecting');
        await connectRoom({
          livekitUrl: res.livekit_url,
          token: res.token,
          e2eeKey,
          callType: type,
        });
      } catch (e) {
        await teardown();
        setPhase('idle');
        setCall(null);
        throw e;
      }
    },
    [connectRoom, teardown],
  );

  const acceptCall = useCallback(async () => {
    const c = callRef.current;
    if (!c || phaseRef.current !== 'incoming') return;
    void clearIncomingCall();
    setPhase('connecting');
    try {
      const res = await callService.accept(c.callId);
      await connectRoom({
        livekitUrl: res.livekit_url,
        token: res.token,
        e2eeKey: c.e2eeKey ?? res.e2ee_key,
        callType: res.call_type,
      });
    } catch (e) {
      await teardown();
      resetToIdle();
      throw e;
    }
  }, [connectRoom, teardown, resetToIdle]);

  acceptCallRef.current = acceptCall;

  const rejectCall = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    void clearIncomingCall();
    try {
      await callService.reject(c.callId);
    } catch {
      /* ignore */
    }
    await teardown();
    resetToIdle();
  }, [teardown, resetToIdle]);

  const hangUp = useCallback(async () => {
    const c = callRef.current;
    if (!c) return;
    void clearIncomingCall();
    try {
      if (phaseRef.current === 'outgoing') await callService.cancel(c.callId);
      else await callService.hangup(c.callId);
    } catch {
      /* ignore */
    }
    await teardown();
    resetToIdle();
  }, [teardown, resetToIdle]);

  const toggleMute = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !muted;
    await r.localParticipant.setMicrophoneEnabled(!next);
    setMuted(next);
  }, [muted]);

  const toggleSpeaker = useCallback(async () => {
    const next = !speaker;
    try {
      if (Platform.OS === 'ios') {
        await AudioSession.selectAudioOutput(next ? 'force_speaker' : 'default');
      } else {
        await AudioSession.selectAudioOutput(next ? 'speaker' : 'earpiece');
      }
    } catch {
      /* ignore : sortie audio indisponible */
    }
    setSpeaker(next);
  }, [speaker]);

  const toggleCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const next = !cameraEnabled;
    await r.localParticipant.setCameraEnabled(next);
    setCameraEnabled(next);
  }, [cameraEnabled]);

  const switchCamera = useCallback(async () => {
    const r = roomRef.current;
    if (!r) return;
    const pub = r.localParticipant.getTrackPublication(Track.Source.Camera);
    const track = pub?.videoTrack;
    if (!track) return;
    // @livekit/react-native-webrtc expose _switchCamera() sur la piste native.
    try {
      const mst = track.mediaStreamTrack as unknown as { _switchCamera?: () => void };
      mst?._switchCamera?.();
    } catch {
      /* ignore */
    }
  }, []);

  const setVideo = useCallback(async (enabled: boolean) => {
    const r = roomRef.current;
    if (!r) return;
    await r.localParticipant.setCameraEnabled(enabled);
    setCameraEnabled(enabled);
    // passe le haut-parleur en vidéo, revient à l'écouteur en voix
    if (enabled && !speaker) {
      try {
        await AudioSession.selectAudioOutput(
          Platform.OS === 'ios' ? 'force_speaker' : 'speaker',
        );
        setSpeaker(true);
      } catch {
        /* ignore */
      }
    }
    setCall((prev) => (prev ? { ...prev, callType: enabled ? 'video' : 'voice' } : prev));
  }, [speaker]);

  // ── écoute des events WS ─────────────────────────────────────────────
  useEffect(() => {
    if (!me) return;
    const off = addListener((e: WsEvent) => {
      switch (e.type) {
        case 'call.incoming': {
          // déjà en appel -> on refuse automatiquement (busy)
          if (phaseRef.current !== 'idle') {
            const cid = String(e.call_id);
            void callService.reject(cid).catch(() => undefined);
            return;
          }
          const caller = (e.caller ?? null) as UserPublic | null;
          const ct = (e.call_type as CallType) ?? 'voice';
          setCall({
            callId: String(e.call_id),
            roomName: String(e.room_name),
            callType: ct,
            peer: caller,
            outgoing: false,
            e2eeKey: (e.e2ee_key as string | null) ?? null,
          });
          setPhase('incoming');
          // si l'utilisateur a tapé "Répondre" sur la notif (app tuée),
          // on accepte dès que l'event arrive et on saute la sonnerie.
          if (pendingAcceptRef.current === String(e.call_id)) {
            pendingAcceptRef.current = null;
            void clearIncomingCall();
            setTimeout(() => void acceptCallRef.current?.(), 0);
          } else {
            // sonnerie native (plein écran + son en boucle)
            void displayIncomingCall({
              callId: String(e.call_id),
              callType: ct,
              callerName: caller?.display_name || caller?.username || 'Appel entrant',
              callerAvatar: caller?.avatar_url ?? null,
            });
          }
          break;
        }
        case 'call.accepted': {
          // l'appelant est déjà dans la room ; on passe juste en "connecting"
          if (phaseRef.current === 'outgoing') setPhase('connecting');
          break;
        }
        case 'call.rejected':
        case 'call.cancelled':
        case 'call.ended': {
          const c = callRef.current;
          if (c && String(e.call_id) === c.callId) {
            void clearIncomingCall();
            void teardown();
            resetToIdle();
          }
          break;
        }
        default:
          break;
      }
    });
    return off;
  }, [me, addListener, teardown, resetToIdle]);

  // ── actions depuis la notification native (boutons Répondre / Refuser) ─
  useEffect(() => {
    const off = onNotificationAction((a) => {
      if (a.kind === 'call-accept') void acceptCall();
      else if (a.kind === 'call-reject') void rejectCall();
      // 'open-incoming-call' : l'app est déjà ramenée au premier plan par
      // fullScreenAction ; le RootNavigator affiche l'IncomingCallScreen.
    });
    return off;
  }, [acceptCall, rejectCall]);

  // ── nettoyage au démontage du provider ──────────────────────────────
  useEffect(() => {
    return () => {
      void clearIncomingCall();
      void teardown();
    };
  }, [teardown]);

  const value = useMemo<CallContextValue>(
    () => ({
      phase,
      call,
      room,
      elapsed,
      muted,
      speaker,
      cameraEnabled,
      available,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      setVideo,
    }),
    [
      phase,
      call,
      room,
      elapsed,
      muted,
      speaker,
      cameraEnabled,
      available,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      setVideo,
    ],
  );

  return <CallContext.Provider value={value}>{children}</CallContext.Provider>;
};

export function useCall(): CallContextValue {
  const ctx = useContext(CallContext);
  if (!ctx) throw new Error('useCall must be used within CallProvider');
  return ctx;
}

/** Formate une durée d'appel en m:ss ou h:mm:ss. */
export function formatCallDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
  return `${m}:${String(r).padStart(2, '0')}`;
}
