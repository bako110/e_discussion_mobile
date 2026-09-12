/**
 * Lecteur de notes vocales — SINGLETON module-level.
 *
 * Un seul lecteur natif pour toute l'app : lancer une note stoppe la
 * précédente. L'état survit à la navigation (quitter le chat n'arrête pas le
 * son) ; un mini-lecteur global (`GlobalVoiceBar`) s'y abonne pour offrir
 * pause / fermeture depuis n'importe quel écran, façon WhatsApp.
 *
 * IMPORTANT — pas de pausePlayer()/resumePlayer() : `react-native-audio-
 * recorder-player` garde son PROPRE état interne (_isPlaying/_hasPaused),
 * séparé de `state` ci-dessous. Dès qu'ils divergent (ex: un stopPlayer()
 * natif ailleurs — un enregistrement démarré pendant la pause d'un vocal —,
 * ou simplement un composant remonté), pausePlayer()/resumePlayer() renvoient
 * un texte de statut ('No audio playing' / 'Already playing') SANS agir sur
 * le vrai lecteur natif, et sans lever d'erreur — le bug se manifestait par
 * « l'icône dit que ça joue, mais rien ne joue ». On simule donc pause/
 * reprise nous-mêmes avec stop + start + seek, jamais avec ces deux appels.
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

/** Démarre réellement la lecture de `url` à `atPositionMs` (0 = début) et
 * branche l'écoute de progression. Unique point qui appelle startPlayer(). */
async function reallyStart(
  url: string,
  atPositionMs: number,
  meta: { conversationId: string | null; title: string | null; durationMs?: number | null },
): Promise<void> {
  await player.startPlayer(url);
  if (atPositionMs > 0) {
    try {
      await player.seekToPlayer(atPositionMs);
    } catch {
      /* tant pis, ça rejoue depuis le début plutôt que d'échouer */
    }
  }
  state = {
    url,
    position: atPositionMs,
    duration: meta.durationMs ?? 0,
    playing: true,
    conversationId: meta.conversationId,
    title: meta.title,
  };
  emit();
  player.addPlayBackListener((e) => {
    state = {
      ...state,
      url,
      position: e.currentPosition,
      duration: e.duration || state.duration,
      playing: !e.isFinished,
      conversationId: meta.conversationId,
      title: meta.title,
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
}

/**
 * Bascule lecture/pause pour `url`. Reprend si on re-tape la note en pause,
 * relance du début si c'est une autre note.
 */
export async function toggleVoice(url: string, meta: PlayMeta = {}): Promise<void> {
  const nextMeta = {
    conversationId: meta.conversationId ?? null,
    title: meta.title ?? null,
    durationMs: meta.durationMs,
  };

  // Même note, en cours de lecture -> pause = stop + on retient la position.
  if (state.url === url && state.playing) {
    const atPosition = state.position;
    await stopVoice();
    state = { ...state, url, position: atPosition, playing: false, ...nextMeta };
    emit();
    return;
  }

  // Même note, en pause -> reprise = redémarre puis saute à la position.
  const resumeFromPosition = state.url === url && !state.playing ? state.position : 0;

  await stopVoice();
  try {
    await reallyStart(url, resumeFromPosition, nextMeta);
  } catch {
    await stopVoice();
  }
}

/** Pause explicite (bouton de la barre globale). */
export async function pauseVoice(): Promise<void> {
  if (!state.playing) return;
  const atPosition = state.position;
  const { url, conversationId, title, duration } = state;
  await stopVoice();
  if (url) {
    state = { url, position: atPosition, duration, playing: false, conversationId, title };
    emit();
  }
}

/** Reprise explicite (bouton de la barre globale). */
export async function resumeVoice(): Promise<void> {
  if (!state.url || state.playing) return;
  const { url, position, conversationId, title, duration } = state;
  try {
    await reallyStart(url, position, { conversationId, title, durationMs: duration });
  } catch {
    /* noop */
  }
}

/**
 * Avance/recule dans le vocal `url` (ex: on glisse sur sa waveform). Ignoré
 * si `url` n'est pas la note actuellement chargée — un geste sur une autre
 * bulle ne doit jamais déplacer la lecture en cours ailleurs.
 *
 * - En LECTURE : `seekToPlayer` marche directement sur le lecteur natif déjà
 *   démarré.
 * - En PAUSE : le lecteur natif est arrêté (cf. note en tête de fichier), donc
 *   pas de seekToPlayer possible — on se contente de mémoriser la nouvelle
 *   position ; `resumeVoice`/`toggleVoice` la reprendront via `reallyStart`.
 */
export async function seekVoice(url: string, positionMs: number): Promise<void> {
  if (state.url !== url) return;
  const max = state.duration > 0 ? state.duration : positionMs;
  const clamped = Math.max(0, Math.min(positionMs, max));
  state = { ...state, position: clamped };
  emit();
  if (state.playing) {
    try {
      await player.seekToPlayer(clamped);
    } catch {
      /* la position optimiste reste affichée même si le seek natif échoue */
    }
  }
}
