/**
 * Lecteur de notes vocales — SINGLETON module-level.
 *
 * Un seul lecteur natif pour toute l'app : lancer une note stoppe la
 * précédente. L'état survit à la navigation (quitter le chat n'arrête pas le
 * son) ; un mini-lecteur global (`GlobalVoiceBar`) s'y abonne pour offrir
 * pause / fermeture depuis n'importe quel écran, façon WhatsApp.
 */
import AudioRecorderPlayer from 'react-native-audio-recorder-player';

const player = new AudioRecorderPlayer();

export interface VoicePlayerState {
  /** URI en cours de lecture (fichier local ou URL distante), ou null. */
  url: string | null;
  position: number; // ms
  duration: number; // ms
  playing: boolean;
  /** conversation d'où le vocal a été lancé — pour masquer la barre dans ce chat. */
  conversationId: string | null;
  /** libellé affiché dans la barre globale (nom du contact / du groupe). */
  title: string | null;
}

let state: VoicePlayerState = {
  url: null,
  position: 0,
  duration: 0,
  playing: false,
  conversationId: null,
  title: null,
};

const subs = new Set<() => void>();
const emit = () => subs.forEach((fn) => fn());

export function getVoiceState(): VoicePlayerState {
  return state;
}

export function subscribeVoice(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}

export async function stopVoice(): Promise<void> {
  try {
    player.removePlayBackListener();
    await player.stopPlayer();
  } catch {
    /* déjà stoppé */
  }
  state = {
    url: null,
    position: 0,
    duration: 0,
    playing: false,
    conversationId: null,
    title: null,
  };
  emit();
}

export interface PlayMeta {
  conversationId?: string | null;
  title?: string | null;
  /** durée connue à l'avance (ms) — affichage avant que le natif la renvoie. */
  durationMs?: number | null;
}

/**
 * Bascule lecture/pause pour `url`. Reprend si on re-tape la note en pause,
 * relance du début si c'est une autre note.
 */
export async function toggleVoice(url: string, meta: PlayMeta = {}): Promise<void> {
  const nextMeta = {
    conversationId: meta.conversationId ?? null,
    title: meta.title ?? null,
  };

  if (state.url === url && state.playing) {
    try {
      await player.pausePlayer();
    } catch {
      /* noop */
    }
    state = { ...state, playing: false };
    emit();
    return;
  }

  // Reprise après pause (même note) : on retient la position ATTEINTE pour
  // pouvoir s'y replacer si le "vrai" resume (ci-dessous) échoue.
  const resumeFromPosition = state.url === url && !state.playing ? state.position : 0;

  if (state.url === url && !state.playing) {
    // react-native-audio-recorder-player garde son PROPRE état interne
    // (_isPlaying/_hasPaused) séparé du nôtre — s'ils divergent (ex: un
    // stopPlayer() natif appelé entre-temps, comme lors d'un enregistrement
    // démarré pendant la pause), resumePlayer() renvoie un texte du genre
    // "No audio playing" SANS jamais reprendre la lecture, mais sans lever
    // d'erreur non plus — notre state passait quand même à playing:true,
    // donnant l'impression que le clic "ne fait rien" (rien ne joue, l'UI
    // dit pourtant que si). On vérifie maintenant le résultat au lieu de le
    // supposer, et on retombe sur un vrai redémarrage + seek si ça a échoué.
    try {
      const res = await player.resumePlayer();
      if (res && res.toLowerCase().includes('no audio')) {
        throw new Error('resumePlayer: lecteur natif déjà arrêté');
      }
      state = { ...state, playing: true };
      emit();
      return;
    } catch {
      /* on retombe sur le redémarrage ci-dessous, avec seek à la position */
    }
  }

  await stopVoice();
  try {
    await player.startPlayer(url);
    if (resumeFromPosition > 0) {
      try {
        await player.seekToPlayer(resumeFromPosition);
      } catch {
        /* tant pis, ça rejoue depuis le début plutôt que d'échouer */
      }
    }
    state = {
      url,
      position: resumeFromPosition,
      duration: meta.durationMs ?? 0,
      playing: true,
      ...nextMeta,
    };
    emit();
    player.addPlayBackListener((e) => {
      state = {
        ...state,
        url,
        position: e.currentPosition,
        duration: e.duration || state.duration,
        playing: !e.isFinished,
        ...nextMeta,
      };
      if (e.isFinished) {
        player.removePlayBackListener();
        state = {
          url: null,
          position: 0,
          duration: 0,
          playing: false,
          conversationId: null,
          title: null,
        };
      }
      emit();
    });
  } catch {
    await stopVoice();
  }
}

/** Pause explicite (bouton de la barre globale). */
export async function pauseVoice(): Promise<void> {
  if (!state.playing) return;
  try {
    await player.pausePlayer();
  } catch {
    /* noop */
  }
  state = { ...state, playing: false };
  emit();
}

/** Reprise explicite (bouton de la barre globale). */
export async function resumeVoice(): Promise<void> {
  if (!state.url || state.playing) return;
  try {
    await player.resumePlayer();
    state = { ...state, playing: true };
    emit();
  } catch {
    /* noop */
  }
}
