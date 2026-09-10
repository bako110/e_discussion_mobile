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
import { AppState, Platform } from 'react-native';
import {
  AndroidAudioTypePresets,
  AudioSession,
  RNE2EEManager,
  RNKeyProvider,
  registerGlobals,
} from '@livekit/react-native';
import { Room, RoomEvent, Track, VideoPresets } from 'livekit-client';

import { useAuth } from '@/context/AuthContext';
import { useCallPrefs } from '@/context/CallPrefsContext';
import { useWs, type WsEvent } from '@/context/WebSocketContext';
import { callService, userService } from '@/services';
import {
  clearIncomingCall,
  displayIncomingCall,
  displayMissedCall,
  ensureNotificationSetup,
  onNotificationAction,
} from '@/services/notificationService';
import { notificationRepo } from '@/db/repositories/notificationRepo';
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

/** Pourquoi l'appel s'est terminé — affiché brièvement avant retour à idle. */
export type EndReason = 'ended' | 'busy' | 'declined' | 'missed' | 'failed' | 'cancelled';

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
  /** motif de fin, valable pendant la phase 'ended'. */
  endReason: EndReason | null;
  call: ActiveCall | null;
  room: Room | null;
  /** secondes écoulées depuis la connexion média (0 hors appel actif). */
  elapsed: number;
  muted: boolean;
  speaker: boolean;
  cameraEnabled: boolean;
  /** true si le SFU est configuré côté serveur. */
  available: boolean;
  /** true = écran d'appel réduit (pilule flottante), l'appel continue. */
  minimized: boolean;

  startCall: (callee: UserPublic, type: CallType) => Promise<void>;
  acceptCall: (opts?: { asAudio?: boolean }) => Promise<void>;
  rejectCall: () => Promise<void>;
  hangUp: () => Promise<void>;
  toggleMute: () => Promise<void>;
  toggleSpeaker: () => Promise<void>;
  toggleCamera: () => Promise<void>;
  switchCamera: () => Promise<void>;
  /** Bascule l'appel voix <-> vidéo à chaud (publie / retire la caméra). */
  setVideo: (enabled: boolean) => Promise<void>;
  /** Réduit l'écran d'appel — l'appel reste actif, pilule flottante. */
  minimize: () => void;
  /** Restaure l'écran d'appel plein écran. */
  restore: () => void;
}

const CallContext = createContext<CallContextValue | null>(null);

export const CallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { me } = useAuth();
  const { addListener, keepAlive } = useWs();
  const prefs = useCallPrefs();
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const [available, setAvailable] = useState(false);
  const [phase, setPhase] = useState<CallPhase>('idle');
  const [endReason, setEndReason] = useState<EndReason | null>(null);
  const [minimized, setMinimized] = useState(false);
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

  // Pendant un appel (toute phase sauf idle), on force le WebSocket à ne
  // jamais lâcher : heartbeat rapide + reconnexion instantanée. Sinon un
  // réseau qui vacille pendant WebRTC ferait perdre les events call.*.
  useEffect(() => {
    keepAlive(phase !== 'idle' && phase !== 'ended');
  }, [phase, keepAlive]);

  // ── disponibilité (config serveur) + setup notifications ─────────────
  // On réessaie quelques fois (réseau lent au lancement) et on revérifie
  // quand l'app repasse au premier plan : un premier échec ne doit pas
  // désactiver les appels pour toute la session.
  useEffect(() => {
    if (!me) {
      setAvailable(false);
      return;
    }
    let alive = true;
    void ensureNotificationSetup();
    // récupération : au démarrage, on clôt tout appel resté fantôme côté
    // serveur (client tué / réseau coupé pendant un précédent appel) — évite
    // les 409 « already_in_call » au prochain appel.
    void callService.clearStuck().catch(() => undefined);

    const check = async (attempt = 0): Promise<void> => {
      try {
        const cfg = await callService.config();
        if (alive) setAvailable(cfg.enabled);
      } catch {
        if (!alive) return;
        if (attempt < 4) {
          setTimeout(() => void check(attempt + 1), 2 ** attempt * 1500);
        } else {
          setAvailable(false);
        }
      }
    };
    void check();

    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void check();
    });
    return () => {
      alive = false;
      sub.remove();
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

  const minimize = useCallback(() => setMinimized(true), []);
  const restore = useCallback(() => setMinimized(false), []);

  const resetToIdle = useCallback((reason?: EndReason) => {
    setEndReason(reason ?? 'ended');
    setMinimized(false);
    setPhase('ended');
    setCall(null);
    // petit délai pour laisser l'UI afficher "Appel terminé / Occupé / Refusé"
    setTimeout(() => {
      setPhase((p) => (p === 'ended' ? 'idle' : p));
      setEndReason(null);
    }, 1600);
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
        // appel 1-to-1 : on veut TOUJOURS émettre l'audio et la vidéo dès
        // qu'ils sont activés. dynacast/adaptiveStream peuvent retarder ou
        // couper la vidéo si l'autre "ne la demande pas encore" -> désactivés.
        adaptiveStream: false,
        dynacast: false,
        e2ee: e2eeManager ? { e2eeManager } : undefined,
        videoCaptureDefaults: {
          resolution: VideoPresets.h720.resolution,
        },
        publishDefaults: {
          simulcast: false, // 1 seule couche : évite que l'autre ne reçoive rien
          videoCodec: 'vp8',
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
      // chrono commun : démarre quand les DEUX sont dans la room (média établi),
      // pas à la connexion — sinon l'appelant compte depuis avant le décroché.
      const startClock = () => {
        if (tickRef.current) return; // déjà démarré
        const startedAt = Date.now();
        setElapsed(0);
        tickRef.current = setInterval(() => {
          setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
      };
      r.on(RoomEvent.ParticipantConnected, () => {
        startClock();
        setPhase('active');
      });
      // filet : si on reçoit une piste de l'autre sans avoir vu
      // ParticipantConnected (rare), on considère l'appel actif.
      r.on(RoomEvent.TrackSubscribed, () => {
        startClock();
        setPhase('active');
      });

      roomRef.current = r;
      setRoom(r);

      if (opts.e2eeKey) {
        await r.setE2EEEnabled(true);
      }
      // autoSubscribe: true -> on reçoit toutes les pistes de l'autre dès
      // qu'elles sont publiées (y compris la vidéo activée plus tard).
      await r.connect(opts.livekitUrl, opts.token, { autoSubscribe: true });

      await r.localParticipant.setMicrophoneEnabled(true);

      const p = prefsRef.current;
      // vidéo : caméra ON sauf mode « économie de données »
      if (opts.callType === 'video' && !p.lowData) {
        await r.localParticipant.setCameraEnabled(true);
        setCameraEnabled(true);
      }
      // haut-parleur : forcé en vidéo, ou si l'utilisateur l'a réglé ainsi
      if (opts.callType === 'video' || p.answerOnSpeaker) {
        try {
          await AudioSession.selectAudioOutput(
            Platform.OS === 'ios' ? 'force_speaker' : 'speaker',
          );
          setSpeaker(true);
        } catch {
          /* ignore */
        }
      }

      // si l'autre est DÉJÀ là (l'un des deux a rejoint la room en second),
      // on démarre tout de suite ; sinon on reste « connexion… » jusqu'à
      // RoomEvent.ParticipantConnected.
      if (r.remoteParticipants.size > 0) {
        startClock();
        setPhase('active');
      } else {
        setPhase('connecting');
      }
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
      let createdId: string | null = null;
      try {
        const res = await callService.start(callee.id, type, e2eeKey);
        createdId = res.id;
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
        const code = (e as { code?: string; status?: number })?.code;
        const status = (e as { status?: number })?.status;

        // 409 : le destinataire est déjà en ligne (callee_busy) OU on a
        // soi-même un appel fantôme (already_in_call). Dans le 2e cas on
        // nettoie et on laisse l'utilisateur réessayer.
        if (status === 409 && code === 'already_in_call') {
          await callService.clearStuck().catch(() => undefined);
        }
        // si le CallLog a été créé côté serveur mais qu'on n'a pas pu
        // rejoindre la room -> l'annuler, sinon appel zombie. Retry.
        if (createdId) {
          for (let i = 0; i < 2; i++) {
            try {
              await callService.cancel(createdId);
              break;
            } catch {
              await new Promise<void>((res) => setTimeout(() => res(), 800));
            }
          }
        }
        await teardown();
        setCall(null);
        if (status === 409 && code === 'callee_busy') {
          resetToIdle('busy'); // « Occupé »
        } else if (status === 403 && code === 'call_blocked') {
          resetToIdle('declined'); // le destinataire refuse mes appels
        } else {
          setPhase('idle');
        }
        throw e;
      }
    },
    [connectRoom, teardown, resetToIdle],
  );

  const acceptCall = useCallback(async (opts?: { asAudio?: boolean }) => {
    const c = callRef.current;
    if (!c || phaseRef.current !== 'incoming') return;
    void clearIncomingCall();
    void notificationRepo.markRead(`call-${c.callId}`);
    setPhase('connecting');
    try {
      const res = await callService.accept(c.callId);
      // « répondre en audio » à un appel vidéo : on rejoint en voix (pas de
      // caméra), l'autre peut toujours envoyer sa vidéo.
      const callType = opts?.asAudio ? 'voice' : res.call_type;
      await connectRoom({
        livekitUrl: res.livekit_url,
        token: res.token,
        e2eeKey: c.e2eeKey ?? res.e2ee_key,
        callType,
      });
      if (opts?.asAudio && res.call_type === 'video') {
        // reflète « vidéo » côté état (l'autre est en vidéo) sans publier la nôtre
        setCall((prev) => (prev ? { ...prev, callType: 'video' } : prev));
      }
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
    // refus explicite : trace « appel refusé » dans l'historique
    void displayMissedCall({
      callId: c.callId,
      callType: c.callType,
      peerId: c.peer?.id ?? '',
      peerName: c.peer?.display_name || c.peer?.username || 'Appel',
      peerAvatar: c.peer?.avatar_url ?? null,
      rejected: true,
    });
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
    const wasOutgoing = phaseRef.current === 'outgoing' || phaseRef.current === 'connecting';

    // libère l'UI et le média TOUT DE SUITE — on ne fait pas attendre
    // l'utilisateur sur le réseau.
    await teardown();
    resetToIdle();

    // puis on clôt côté serveur, avec retry (sinon appel zombie -> 409).
    if (c.callId && c.callId !== 'pending') {
      const close = wasOutgoing ? callService.cancel : callService.hangup;
      for (let i = 0; i < 3; i++) {
        try {
          await close(c.callId);
          break;
        } catch {
          await new Promise<void>((res) => setTimeout(() => res(), 2 ** i * 700));
        }
      }
    }
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
    // publie/retire explicitement la piste caméra (h720, non simulcast) pour
    // que l'autre la reçoive tout de suite (crée la piste si on était en voix).
    await r.localParticipant.setCameraEnabled(
      next,
      next ? { resolution: VideoPresets.h720.resolution } : undefined,
    );
    setCameraEnabled(next);
    // reflète le type d'appel : dès que MA caméra est active, on est "vidéo"
    setCall((prev) =>
      prev ? { ...prev, callType: next ? 'video' : prev.callType } : prev,
    );
    // caméra ON -> haut-parleur
    if (next && !speaker) {
      try {
        await AudioSession.selectAudioOutput(
          Platform.OS === 'ios' ? 'force_speaker' : 'speaker',
        );
        setSpeaker(true);
      } catch {
        /* ignore */
      }
    }
  }, [cameraEnabled, speaker]);

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
    // publication explicite de la caméra (h720) -> l'autre la reçoit
    // immédiatement grâce à autoSubscribe + dynacast off.
    await r.localParticipant.setCameraEnabled(
      enabled,
      enabled ? { resolution: VideoPresets.h720.resolution } : undefined,
    );
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
          const cid = String(e.call_id);
          // déjà en appel -> refus automatique avec le motif "occupé".
          if (phaseRef.current !== 'idle') {
            void callService.reject(cid, 'busy').catch(() => undefined);
            return;
          }
          const caller = (e.caller ?? null) as UserPublic | null;
          // bloquer les appels d'inconnus (préférence) : refus silencieux si
          // l'appelant n'est pas dans mes contacts connus.
          if (prefsRef.current.blockUnknown && caller) {
            const known = userService.knownContactIds();
            if (!known.includes(caller.id)) {
              void callService.reject(cid, 'declined').catch(() => undefined);
              return;
            }
          }
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
            const wasIncoming = phaseRef.current === 'incoming';
            const wasConnected =
              phaseRef.current === 'active' || phaseRef.current === 'connecting';
            void clearIncomingCall();
            void teardown();
            let reason: EndReason = 'ended';
            if (e.type === 'call.rejected') {
              reason = e.reason === 'busy' ? 'busy' : 'declined';
            } else if (e.type === 'call.cancelled') {
              reason = 'cancelled';
            } else if (e.status === 'missed') {
              reason = 'missed';
            }
            // appel entrant terminé SANS qu'on ait décroché -> appel manqué
            if (!c.outgoing && wasIncoming && !wasConnected) {
              void displayMissedCall({
                callId: c.callId,
                callType: c.callType,
                peerId: c.peer?.id ?? '',
                peerName:
                  c.peer?.display_name || c.peer?.username || 'Appel manqué',
                peerAvatar: c.peer?.avatar_url ?? null,
              });
            } else if (!c.outgoing) {
              // décroché puis raccroché : l'entrée d'historique « entrant »
              // n'est plus « non lue »
              void notificationRepo.markRead(`call-${c.callId}`);
            }
            resetToIdle(reason);
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
      else if (a.kind === 'call-back') {
        // « Rappeler » depuis une notif d'appel manqué
        void (async () => {
          if (phaseRef.current !== 'idle') return;
          const peer = await userService.getById(a.peerId).catch(() => null);
          if (peer) void startCall(peer, a.callType);
        })();
      }
      // 'open-incoming-call' : l'app est déjà ramenée au premier plan par
      // fullScreenAction ; le RootNavigator affiche l'IncomingCallScreen.
    });
    return off;
  }, [acceptCall, rejectCall, startCall]);

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
      endReason,
      call,
      room,
      elapsed,
      muted,
      speaker,
      cameraEnabled,
      available,
      minimized,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      setVideo,
      minimize,
      restore,
    }),
    [
      phase,
      endReason,
      call,
      room,
      elapsed,
      muted,
      speaker,
      cameraEnabled,
      available,
      minimized,
      startCall,
      acceptCall,
      rejectCall,
      hangUp,
      toggleMute,
      toggleSpeaker,
      toggleCamera,
      switchCamera,
      setVideo,
      minimize,
      restore,
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
