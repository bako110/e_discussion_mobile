/**
 * Découpage (trim) d'une vidéo AVANT envoi — messagerie, stories, groupes.
 *
 * L'utilisateur choisit le segment à montrer via l'éditeur natif
 * (`react-native-video-trim`, poignées début/fin). La vidéo est coupée
 * LOCALEMENT : rien ne part au serveur avant l'envoi.
 *
 * Nécessite un build natif à jour (module `react-native-video-trim`). Si le
 * module est absent, `trimVideo` renvoie `null` et l'appelant garde la vidéo
 * d'origine (pas de blocage).
 */
import { NativeEventEmitter, NativeModules } from 'react-native';

import { asDisplayUri, ensureFilePath } from '@/utils/imageEdit';

export interface TrimmedVideo {
  uri: string; // file://… du segment découpé
  durationSec: number;
  startSec: number;
  endSec: number;
}

/** `true` si le module natif de trim est présent dans le build courant. */
export function isVideoTrimAvailable(): boolean {
  return !!NativeModules.VideoTrim || !!NativeModules.RNVideoTrim;
}

/**
 * Ouvre l'éditeur de découpe. Résout :
 *  - `TrimmedVideo` si l'utilisateur valide un segment ;
 *  - `null` s'il annule OU si le module natif n'est pas disponible.
 */
export async function trimVideo(
  rawUri: string,
  opts: { headerText?: string } = {},
): Promise<TrimmedVideo | null> {
  let mod: typeof import('react-native-video-trim');
  try {
    mod = await import('react-native-video-trim');
  } catch (e) {
    console.warn('[videoEdit] module react-native-video-trim absent:', e);
    return null;
  }
  if (!isVideoTrimAvailable()) {
    console.warn('[videoEdit] natif VideoTrim absent du build — trim ignoré');
    return null;
  }

  const path = await ensureFilePath(rawUri);

  // Valide le fichier
  try {
    const info = await mod.isValidFile(path);
    if (info && info.isValid === false) {
      console.warn('[videoEdit] fichier vidéo invalide');
      return null;
    }
  } catch {
    /* best-effort */
  }

  const emitter = new NativeEventEmitter(
    NativeModules.VideoTrim ?? NativeModules.RNVideoTrim,
  );

  return new Promise<TrimmedVideo | null>((resolve) => {
    let settled = false;
    const subs: { remove: () => void }[] = [];
    const cleanup = () => {
      subs.forEach((s) => {
        try {
          s.remove();
        } catch {
          /* noop */
        }
      });
    };
    const finish = (val: TrimmedVideo | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(val);
    };

    subs.push(
      emitter.addListener('onFinishTrimming', (p: {
        outputPath: string;
        startTime: number;
        endTime: number;
        duration: number;
      }) => {
        finish({
          uri: asDisplayUri(p.outputPath),
          durationSec: Math.max(0, Math.round((p.duration ?? 0) / 1000)),
          startSec: (p.startTime ?? 0) / 1000,
          endSec: (p.endTime ?? 0) / 1000,
        });
      }),
    );
    subs.push(emitter.addListener('onCancel', () => finish(null)));
    subs.push(emitter.addListener('onCancelTrimming', () => finish(null)));
    subs.push(
      emitter.addListener('onError', (p: { message?: string }) => {
        console.warn('[videoEdit] onError:', p?.message);
        finish(null);
      }),
    );

    try {
      mod.showEditor(path, {
        type: 'video',
        outputExt: 'mp4',
        saveToPhoto: false,
        openShareSheetOnFinish: false,
        openDocumentsOnFinish: false,
        enableCancelDialog: false,
        enableSaveDialog: false,
        headerText: opts.headerText,
        trimmingText: 'Découpage…',
        cancelButtonText: 'Annuler',
        saveButtonText: 'OK',
        theme: 'dark',
        trimmerColor: '#1E6FE0',
        // Par défaut la lib coupe au keyframe le plus proche (stream copy,
        // rapide mais imprécis — peut dériver de plusieurs secondes selon
        // l'espacement des keyframes de la vidéo). On force le ré-encodage
        // pour que le segment envoyé soit EXACTEMENT celui choisi.
        enablePreciseTrimming: true,
        // ne lance pas la lecture à l'ouverture — laisse le temps de
        // positionner les poignées avant que la vidéo ne défile toute seule.
        autoplay: false,
      });
    } catch (e) {
      console.warn('[videoEdit] showEditor a échoué:', e);
      finish(null);
    }
  });
}
