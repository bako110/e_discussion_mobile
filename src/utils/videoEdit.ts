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

  // En New Architecture (Fabric/TurboModules — notre cas), les events de
  // cette lib NE PASSENT PAS par `NativeEventEmitter`/`RCTDeviceEventEmitter` :
  // ce sont des `EventEmitter` Codegen exposés comme méthodes directement sur
  // le module natif (`nativeMod.onFinishTrimming(cb)` renvoie l'abonnement).
  // Utiliser `NativeEventEmitter` ici ne lève AUCUNE erreur mais n'écoute
  // jamais rien : le natif termine le trim (confirmé par les logs ffmpeg),
  // l'event part bien, mais ce mauvais canal d'écoute ne le reçoit jamais —
  // d'où le découpage qui semblait tourner indéfiniment (en fait terminé
  // côté natif, jamais su côté JS). Cf. README de la lib, sections
  // « New Architecture » vs « Old Architecture ».
  const isFabric = !!(globalThis as any).nativeFabricUIManager;
  const nativeMod = mod.default as any;

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
      clearTimeout(watchdog);
      resolve(val);
    };
    // Filet de sécurité : si jamais AUCUN des deux canaux d'événements
    // (New Arch EventEmitter / Old Arch NativeEventEmitter) ne délivre —
    // exactement le bug qui nous a fait chercher pendant des heures un
    // découpage "qui ne finit jamais" alors qu'il réussissait déjà côté
    // natif — on n'attend plus indéfiniment. Largement au-dessus du temps
    // d'un ré-encodage réel (quelques secondes à quelques dizaines de
    // secondes pour une vidéo de story).
    const watchdog = setTimeout(() => {
      console.warn('[videoEdit] aucun événement de fin de trim reçu après 3min — abandon');
      finish(null);
    }, 180_000);

    const onFinish = (p: {
      outputPath: string;
      startTime: number;
      endTime: number;
      duration: number;
    }) => {
      // BUG CONFIRMÉ de react-native-video-trim (8.2.2, natif Android) :
      // `duration` dans l'event onFinishTrimming est la durée du FICHIER
      // ORIGINAL (mDuration, passée telle quelle à VideoTrimmerUtil.trim()
      // puis renvoyée sans recalcul dans onFinishTrim), PAS celle du segment
      // réellement coupé. Repéré via une story publiée avec `duration_sec:
      // 90` (durée de la source de 90s) alors que le clip coupé ne fait que
      // ~13s — la vidéo terminait de jouer bien avant la fin du timer
      // d'affichage du statut, donnant l'impression qu'elle ne jouait pas
      // du tout. `startTime`/`endTime` (les poignées choisies), eux, sont
      // corrects — on calcule la vraie durée à partir d'eux, jamais de
      // `duration`.
      const startSec = (p.startTime ?? 0) / 1000;
      const endSec = (p.endTime ?? 0) / 1000;
      finish({
        uri: asDisplayUri(p.outputPath),
        durationSec: Math.max(0, Math.round(endSec - startSec)),
        startSec,
        endSec,
      });
    };
    const onErr = (p: { message?: string }) => {
      console.warn('[videoEdit] onError:', p?.message);
      finish(null);
    };

    if (isFabric && typeof nativeMod?.onFinishTrimming === 'function') {
      // New Architecture : chaque event est une méthode EventEmitter directe.
      subs.push(nativeMod.onFinishTrimming(onFinish));
      subs.push(nativeMod.onCancel(() => finish(null)));
      subs.push(nativeMod.onCancelTrimming(() => finish(null)));
      subs.push(nativeMod.onError(onErr));
    } else {
      // Old Architecture : un seul canal `NativeEventEmitter`, events
      // distingués par leur champ `name` (voir README, section Old Arch).
      const emitter = new NativeEventEmitter(
        NativeModules.VideoTrim ?? NativeModules.RNVideoTrim,
      );
      subs.push(
        emitter.addListener('VideoTrim', (event: { name: string } & Record<string, unknown>) => {
          switch (event.name) {
            case 'onFinishTrimming':
              onFinish(event as unknown as Parameters<typeof onFinish>[0]);
              break;
            case 'onCancel':
            case 'onCancelTrimming':
              finish(null);
              break;
            case 'onError':
              onErr(event as { message?: string });
              break;
            default:
              break;
          }
        }),
      );
      // certaines versions old-arch émettent aussi directement par nom d'event
      subs.push(emitter.addListener('onFinishTrimming', onFinish));
      subs.push(emitter.addListener('onCancel', () => finish(null)));
      subs.push(emitter.addListener('onCancelTrimming', () => finish(null)));
      subs.push(emitter.addListener('onError', onErr));
    }

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
