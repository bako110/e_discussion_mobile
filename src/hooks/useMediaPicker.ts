import { useCallback, useRef, useState } from 'react';
import { PermissionsAndroid, Platform } from 'react-native';
import { alertError, showAlert } from '@/components/common';
import {
  launchCamera,
  launchImageLibrary,
  type Asset,
  type CameraOptions,
  type ImageLibraryOptions,
  type PhotoQuality,
} from 'react-native-image-picker';
import AudioRecorderPlayer, {
  AudioEncoderAndroidType,
  AudioSourceAndroidType,
  AVEncoderAudioQualityIOSType,
  AVEncodingOption,
  OutputFormatAndroidType,
  type AudioSet,
} from 'react-native-audio-recorder-player';
import Geolocation from '@react-native-community/geolocation';
import ReactNativeBlobUtil from 'react-native-blob-util';

// On gère nous-mêmes la demande de permission (dialogue custom) : on dit au
// module de ne PAS la redemander, et on autorise le provider Android natif
// (LocationManager) en secours quand les Play Services ne répondent pas.
Geolocation.setRNConfiguration({
  skipPermissionRequests: true,
  authorizationLevel: 'whenInUse',
  locationProvider: 'auto',
});

import type { UploadFile } from '@/api';
import { mediaService, type UploadedMedia } from '@/services';

/**
 * Sélection & upload de médias — galerie / caméra (photo, vidéo), document,
 * note vocale et position GPS. Nécessite un build natif à jour
 * (`react-native-image-picker`, `react-native-audio-recorder-player`,
 * `@react-native-documents/picker`, `@react-native-community/geolocation`).
 *
 * Deux familles d'API :
 *  - `pickImage/pickVideo/pickDocument/stopRecording` : upload IMMÉDIAT — pour
 *    les cas qui exigent le serveur tout de suite (avatar, groupe, story) ;
 *  - `pick*Local` / `stopRecordingLocal` : renvoient juste le FICHIER LOCAL,
 *    sans réseau — pour l'envoi de message offline-first (l'upload est
 *    différé et rejoué par l'outbox). Voir `pendingMediaService`.
 */

export interface PickedLocation {
  latitude: number;
  longitude: number;
  accuracy: number | null;
}

export interface PickedDocument {
  media: UploadedMedia;
  name: string;
  mime: string | null;
}

/** Fichier choisi mais PAS encore envoyé (offline-first). */
export interface LocalMediaFile {
  file: UploadFile; // { uri, name, type } prêt pour un futur upload
  kind: 'image' | 'video' | 'file' | 'voice';
  size: number | null;
  width: number | null;
  height: number | null;
  durationSec: number | null;
}

const audioRecorder = new AudioRecorderPlayer();

// Réglages d'encodage explicites (AAC dans un conteneur MPEG-4 .m4a) — plus
// fiable que le défaut selon les appareils, et lisible partout.
const AUDIO_SET: AudioSet = {
  AudioSourceAndroid: AudioSourceAndroidType.MIC,
  OutputFormatAndroid: OutputFormatAndroidType.MPEG_4,
  AudioEncoderAndroid: AudioEncoderAndroidType.AAC,
  AudioSamplingRateAndroid: 44100,
  AudioEncodingBitRateAndroid: 128000,
  AVFormatIDKeyIOS: AVEncodingOption.aac,
  AVSampleRateKeyIOS: 44100,
  AVNumberOfChannelsKeyIOS: 1,
  AVEncoderAudioQualityKeyIOS: AVEncoderAudioQualityIOSType.high,
};

const REC_DIR = `${ReactNativeBlobUtil.fs.dirs.CacheDir}/voice`;
let recDirReady: Promise<void> | null = null;
function ensureRecDir(): Promise<void> {
  if (!recDirReady) {
    recDirReady = ReactNativeBlobUtil.fs
      .isDir(REC_DIR)
      .then((ok) => (ok ? undefined : ReactNativeBlobUtil.fs.mkdir(REC_DIR).then(() => undefined)))
      .catch(() => undefined);
  }
  return recDirReady;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Verrou global : évite qu'un `startRecorder` parte pendant qu'un
// `stopRecorder` précédent n'a pas fini de libérer le micro (cause n°1 du
// « Impossible de démarrer l'enregistrement »).
let recBusy: Promise<unknown> | null = null;
async function withRecLock<T>(fn: () => Promise<T>): Promise<T> {
  while (recBusy) {
    try {
      await recBusy;
    } catch {
      /* ignore */
    }
  }
  const p = fn();
  recBusy = p.finally(() => {
    recBusy = null;
  });
  return p;
}

function assetToFile(asset: Asset | undefined, fallbackType: string): UploadFile | null {
  if (!asset?.uri) return null;
  const name = asset.fileName || asset.uri.split('/').pop() || `upload_${Date.now()}`;
  return { uri: asset.uri, name, type: asset.type || fallbackType };
}

export interface MediaPicker {
  busy: boolean;
  pickImage: (opts?: { camera?: boolean }) => Promise<UploadedMedia | null>;
  pickVideo: (opts?: { camera?: boolean }) => Promise<UploadedMedia | null>;
  pickDocument: () => Promise<PickedDocument | null>;
  pickLocation: () => Promise<PickedLocation | null>;
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<{ media: UploadedMedia; durationSec: number } | null>;
  cancelRecording: () => Promise<void>;
  pauseRecording: () => Promise<void>;
  resumeRecording: () => Promise<void>;
  recording: boolean;
  recordingPaused: boolean;
  recordSeconds: number;
  // ── offline-first : renvoient le fichier local, aucun réseau ──
  pickImageLocal: (opts?: { camera?: boolean }) => Promise<LocalMediaFile | null>;
  pickVideoLocal: (opts?: { camera?: boolean }) => Promise<LocalMediaFile | null>;
  pickDocumentLocal: () => Promise<LocalMediaFile | null>;
  stopRecordingLocal: () => Promise<LocalMediaFile | null>;
  /**
   * Sélectionne une photo + recadrage CIRCULAIRE (façon avatar), puis
   * l'uploade UNE fois. Renvoie l'URL serveur. `null` si annulé/échec.
   */
  pickAvatar: (opts?: { camera?: boolean }) => Promise<UploadedMedia | null>;
}

async function ensureAndroidCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.CAMERA,
      {
        title: 'Caméra',
        message: "L'accès à la caméra est nécessaire pour prendre une photo ou une vidéo.",
        buttonPositive: 'OK',
        buttonNegative: 'Annuler',
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function ensureAndroidAudioPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
      {
        title: 'Micro',
        message: "L'accès au micro est nécessaire pour enregistrer une note vocale.",
        buttonPositive: 'OK',
        buttonNegative: 'Annuler',
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

async function ensureAndroidLocationPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  try {
    const res = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
      {
        title: 'Position',
        message: 'Autorisez la localisation pour partager votre position dans la conversation.',
        buttonPositive: 'OK',
        buttonNegative: 'Annuler',
      },
    );
    return res === PermissionsAndroid.RESULTS.GRANTED;
  } catch {
    return false;
  }
}

export function useMediaPicker(): MediaPicker {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordingPaused, setRecordingPaused] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordSecondsRef = useRef(0);
  const recordPathRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRecording = useRef(false);
  const pausedRef = useRef(false);

  const runPick = useCallback(
    async (kind: 'photo' | 'video', camera: boolean): Promise<UploadedMedia | null> => {
      if (camera && !(await ensureAndroidCameraPermission())) {
        showAlert('Caméra', 'Autorisez la caméra dans les réglages pour continuer.');
        return null;
      }
      setBusy(true);
      try {
        const common: CameraOptions & ImageLibraryOptions = {
          mediaType: kind,
          quality: 0.85 as PhotoQuality,
          videoQuality: 'medium',
          selectionLimit: 1,
          includeExtra: false,
          saveToPhotos: false,
        };
        const res = camera
          ? await launchCamera(common)
          : await launchImageLibrary(common);

        if (res.didCancel) return null;
        if (res.errorCode) {
          alertError('Erreur', res.errorMessage || res.errorCode);
          return null;
        }
        const file = assetToFile(
          res.assets?.[0],
          kind === 'photo' ? 'image/jpeg' : 'video/mp4',
        );
        if (!file) return null;
        return await mediaService.upload(file);
      } catch (e) {
        console.warn('[media] pick failed:', e);
        alertError('Erreur', "L'envoi du média a échoué.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const pickImage = useCallback(
    (opts?: { camera?: boolean }) => runPick('photo', !!opts?.camera),
    [runPick],
  );
  const pickVideo = useCallback(
    (opts?: { camera?: boolean }) => runPick('video', !!opts?.camera),
    [runPick],
  );

  /**
   * Photo de profil / avatar de groupe : on sélectionne, on RECADRE en
   * cercle localement (aucun réseau pendant l'édition), puis on uploade
   * UNE seule fois le fichier recadré — façon WhatsApp.
   */
  const pickAvatar = useCallback(
    async (opts?: { camera?: boolean }): Promise<UploadedMedia | null> => {
      const camera = !!opts?.camera;
      if (camera && !(await ensureAndroidCameraPermission())) {
        showAlert('Caméra', 'Autorisez la caméra dans les réglages pour continuer.');
        return null;
      }
      setBusy(true);
      try {
        const common: CameraOptions & ImageLibraryOptions = {
          mediaType: 'photo',
          quality: 0.9 as PhotoQuality,
          selectionLimit: 1,
          includeExtra: false,
          saveToPhotos: false,
        };
        const res = camera ? await launchCamera(common) : await launchImageLibrary(common);
        if (res.didCancel) return null;
        if (res.errorCode) {
          alertError('Erreur', res.errorMessage || res.errorCode);
          return null;
        }
        const rawUri = res.assets?.[0]?.uri;
        if (!rawUri) return null;

        // Recadrage circulaire local (éditeur natif, hors ligne). `cropImage`
        // résout d'abord un chemin fichier fiable (copie si `content://`).
        const { cropImage } = await import('@/utils/imageEdit');
        const cropped = await cropImage(rawUri, {
          circle: true,
          width: 512,
          height: 512,
          title: 'Photo de profil',
        });
        if (!cropped) return null;
        const name = cropped.uri.split('/').pop() || `avatar_${Date.now()}.jpg`;
        return await mediaService.upload({ uri: cropped.uri, name, type: 'image/jpeg' });
      } catch (e) {
        console.warn('[media] pickAvatar failed:', e);
        alertError('Erreur', "L'envoi de la photo a échoué.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  // ── offline-first : sélectionne le fichier SANS l'uploader ──────────────
  const runPickLocal = useCallback(
    async (kind: 'photo' | 'video', camera: boolean): Promise<LocalMediaFile | null> => {
      if (camera && !(await ensureAndroidCameraPermission())) {
        showAlert('Caméra', 'Autorisez la caméra dans les réglages pour continuer.');
        return null;
      }
      setBusy(true);
      try {
        const common: CameraOptions & ImageLibraryOptions = {
          mediaType: kind,
          quality: 0.85 as PhotoQuality,
          videoQuality: 'medium',
          selectionLimit: 1,
          includeExtra: true,
          saveToPhotos: false,
        };
        const res = camera ? await launchCamera(common) : await launchImageLibrary(common);
        if (res.didCancel) return null;
        if (res.errorCode) {
          alertError('Erreur', res.errorMessage || res.errorCode);
          return null;
        }
        const asset = res.assets?.[0];
        const file = assetToFile(asset, kind === 'photo' ? 'image/jpeg' : 'video/mp4');
        if (!file) return null;
        return {
          file,
          kind: kind === 'photo' ? 'image' : 'video',
          size: asset?.fileSize ?? null,
          width: asset?.width ?? null,
          height: asset?.height ?? null,
          durationSec: asset?.duration ?? null,
        };
      } catch (e) {
        console.warn('[media] pick local failed:', e);
        alertError('Erreur', 'Impossible de sélectionner ce média.');
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const pickImageLocal = useCallback(
    (opts?: { camera?: boolean }) => runPickLocal('photo', !!opts?.camera),
    [runPickLocal],
  );
  const pickVideoLocal = useCallback(
    (opts?: { camera?: boolean }) => runPickLocal('video', !!opts?.camera),
    [runPickLocal],
  );

  const pickDocumentLocal = useCallback(async (): Promise<LocalMediaFile | null> => {
    const picker = await import('@react-native-documents/picker');
    let res: { uri: string; name: string | null; type: string | null; size: number | null };
    try {
      [res] = await picker.pick({ type: [picker.types.allFiles], allowMultiSelection: false });
    } catch (e) {
      if (picker.isErrorWithCode(e) && e.code === picker.errorCodes.OPERATION_CANCELED) {
        return null;
      }
      console.warn('[media] document pick local failed:', e);
      alertError('Erreur', 'Impossible de sélectionner ce document.');
      return null;
    }
    if (!res?.uri) return null;
    const name = res.name || res.uri.split('/').pop() || `document_${Date.now()}`;
    setBusy(true);
    try {
      // Android : content:// -> copie locale stable (survit à la fermeture du picker)
      let localUri = res.uri;
      if (Platform.OS === 'android' && res.uri.startsWith('content://')) {
        const [copy] = await picker.keepLocalCopy({
          files: [{ uri: res.uri, fileName: name }],
          destination: 'cachesDirectory',
        });
        if (copy.status === 'success') localUri = copy.localUri;
      }
      return {
        file: { uri: localUri, name, type: res.type || 'application/octet-stream' },
        kind: 'file',
        size: res.size ?? null,
        width: null,
        height: null,
        durationSec: null,
      };
    } finally {
      setBusy(false);
    }
  }, []);

  const pickDocument = useCallback(async (): Promise<PickedDocument | null> => {
    // import paresseux : le module natif n'est présent qu'après un rebuild
    const picker = await import('@react-native-documents/picker');
    let res: { uri: string; name: string | null; type: string | null; size: number | null };
    try {
      [res] = await picker.pick({ type: [picker.types.allFiles], allowMultiSelection: false });
    } catch (e) {
      if (picker.isErrorWithCode(e) && e.code === picker.errorCodes.OPERATION_CANCELED) {
        return null;
      }
      console.warn('[media] document pick failed:', e);
      alertError('Erreur', 'Impossible de sélectionner ce document.');
      return null;
    }
    if (!res?.uri) return null;
    const name = res.name || res.uri.split('/').pop() || `document_${Date.now()}`;
    setBusy(true);
    try {
      // Android renvoie un content:// non lisible par fetch/FormData → copie locale
      let uploadUri = res.uri;
      if (Platform.OS === 'android' && res.uri.startsWith('content://')) {
        const [copy] = await picker.keepLocalCopy({
          files: [{ uri: res.uri, fileName: name }],
          destination: 'cachesDirectory',
        });
        if (copy.status === 'success') uploadUri = copy.localUri;
      }
      const file: UploadFile = {
        uri: uploadUri,
        name,
        type: res.type || 'application/octet-stream',
      };
      const media = await mediaService.upload(file);
      return { media, name, mime: res.type ?? null };
    } catch (e) {
      console.warn('[media] document upload failed:', e);
      alertError('Erreur', "L'envoi du document a échoué.");
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  const pickLocation = useCallback(async (): Promise<PickedLocation | null> => {
    if (!(await ensureAndroidLocationPermission())) {
      showAlert('Position', 'Autorisez la localisation pour partager votre position.');
      return null;
    }
    setBusy(true);

    const once = (opts: Parameters<typeof Geolocation.getCurrentPosition>[2]) =>
      new Promise<PickedLocation>((resolve, reject) => {
        Geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            }),
          (err) => reject(err),
          opts,
        );
      });

    try {
      // 1) tentative rapide : position réseau / dernière connue (marche en
      //    intérieur, pas besoin d'un fix GPS).
      try {
        return await once({
          enableHighAccuracy: false,
          timeout: 8000,
          maximumAge: 60000,
        });
      } catch (e1) {
        console.warn('[media] location (fast) failed:', (e1 as { message?: string })?.message);
      }
      // 2) secours : fix GPS précis, délai plus long.
      try {
        return await once({
          enableHighAccuracy: true,
          timeout: 25000,
          maximumAge: 0,
        });
      } catch (e2) {
        const code = (e2 as { code?: number })?.code;
        const msg =
          code === 1
            ? 'Autorisez la localisation pour partager votre position.'
            : code === 2
              ? "Position indisponible. Activez le GPS et réessayez à l'extérieur."
              : 'Le repérage a pris trop de temps. Réessayez.';
        showAlert('Position', msg);
        return null;
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const startTick = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = setInterval(() => {
      if (pausedRef.current) return;
      recordSecondsRef.current += 1;
      setRecordSeconds(recordSecondsRef.current);
    }, 1000);
  }, []);

  const startRecording = useCallback(async () => {
    if (activeRecording.current) return true;
    if (!(await ensureAndroidAudioPermission())) {
      showAlert('Micro', "L'accès au micro est nécessaire pour enregistrer.");
      return false;
    }

    const ok = await withRecLock(async () => {
      await ensureRecDir();
      // s'assure qu'aucun enregistrement fantôme ne tient encore le micro
      try {
        await audioRecorder.stopRecorder();
      } catch {
        /* rien en cours — normal */
      }
      audioRecorder.removeRecordBackListener?.();

      const dest = `${REC_DIR}/voice_${Date.now()}.m4a`;
      // 2 tentatives : la 1re peut échouer si le micro n'est pas encore libéré
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          if (attempt > 0) await sleep(250);
          const path = await audioRecorder.startRecorder(dest, AUDIO_SET, false);
          recordPathRef.current = path || `file://${dest}`;
          return true;
        } catch (e) {
          console.warn(`[media] startRecorder tentative ${attempt + 1} échouée:`, String(e));
        }
      }
      return false;
    });

    if (!ok) {
      alertError('Erreur', "Impossible de démarrer l'enregistrement. Réessayez.");
      return false;
    }

    activeRecording.current = true;
    pausedRef.current = false;
    setRecording(true);
    setRecordingPaused(false);
    setRecordSeconds(0);
    recordSecondsRef.current = 0;
    startTick();
    return true;
  }, [startTick]);

  /** Met l'enregistrement en pause (le temps se fige). */
  const pauseRecording = useCallback(async () => {
    if (!activeRecording.current || pausedRef.current) return;
    try {
      await audioRecorder.pauseRecorder();
      pausedRef.current = true;
      setRecordingPaused(true);
    } catch (e) {
      console.warn('[media] pause failed:', e);
    }
  }, []);

  /** Reprend un enregistrement en pause. */
  const resumeRecording = useCallback(async () => {
    if (!activeRecording.current || !pausedRef.current) return;
    try {
      await audioRecorder.resumeRecorder();
      pausedRef.current = false;
      setRecordingPaused(false);
    } catch (e) {
      console.warn('[media] resume failed:', e);
    }
  }, []);

  const finishRecorder = useCallback(async (): Promise<{ path: string | null; seconds: number }> => {
    const seconds = recordSecondsRef.current;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setRecording(false);
    setRecordingPaused(false);
    pausedRef.current = false;
    if (!activeRecording.current) return { path: null, seconds };
    activeRecording.current = false;
    return withRecLock(async () => {
      try {
        // si en pause, reprendre avant de pouvoir stopper proprement
        await audioRecorder.resumeRecorder().catch(() => undefined);
        const path = await audioRecorder.stopRecorder();
        audioRecorder.removeRecordBackListener?.();
        return { path: path || recordPathRef.current, seconds };
      } catch {
        return { path: recordPathRef.current, seconds };
      }
    });
  }, []);

  const stopRecording = useCallback(async (): Promise<{
    media: UploadedMedia;
    durationSec: number;
  } | null> => {
    const { path, seconds } = await finishRecorder();
    if (!path) return null;
    setBusy(true);
    try {
      const uri =
        path.startsWith('file://') || path.startsWith('http') ? path : `file://${path}`;
      const name = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
      const media = await mediaService.upload({ uri, name, type: 'audio/mp4' });
      return { media, durationSec: media.duration_sec ?? seconds };
    } catch (e) {
      console.warn('[media] record upload failed:', e);
      alertError('Erreur', "L'envoi de la note vocale a échoué.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [finishRecorder]);

  /** Arrête l'enregistrement et renvoie le FICHIER LOCAL (pas d'upload). */
  const stopRecordingLocal = useCallback(async (): Promise<LocalMediaFile | null> => {
    const { path, seconds } = await finishRecorder();
    if (!path) return null;
    const uri =
      path.startsWith('file://') || path.startsWith('http') ? path : `file://${path}`;
    const name = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
    return {
      file: { uri, name, type: 'audio/mp4' },
      kind: 'voice',
      size: null,
      width: null,
      height: null,
      durationSec: seconds,
    };
  }, [finishRecorder]);

  const cancelRecording = useCallback(async () => {
    await finishRecorder();
  }, [finishRecorder]);

  return {
    busy,
    pickImage,
    pickVideo,
    pickDocument,
    pickLocation,
    startRecording,
    stopRecording,
    cancelRecording,
    pauseRecording,
    resumeRecording,
    recording,
    recordingPaused,
    recordSeconds,
    pickImageLocal,
    pickVideoLocal,
    pickDocumentLocal,
    stopRecordingLocal,
    pickAvatar,
  };
}
