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
import AudioRecorderPlayer from 'react-native-audio-recorder-player';
import Geolocation from '@react-native-community/geolocation';

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
  recording: boolean;
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
  const [recordSeconds, setRecordSeconds] = useState(0);
  const recordSecondsRef = useRef(0);
  const recordPathRef = useRef<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRecording = useRef(false);

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

        // Recadrage circulaire local (éditeur natif, hors ligne)
        const ImagePicker = (await import('react-native-image-crop-picker')).default;
        let cropped: { path: string; mime?: string };
        try {
          cropped = (await ImagePicker.openCropper({
            path: /^(content:|file:|http|data:)/.test(rawUri) ? rawUri : `file://${rawUri}`,
            mediaType: 'photo',
            width: 512,
            height: 512,
            cropperCircleOverlay: true,
            cropperToolbarTitle: 'Photo de profil',
            cropperActiveWidgetColor: '#1E6FE0',
            cropperToolbarColor: '#000000',
            cropperToolbarWidgetColor: '#FFFFFF',
            compressImageQuality: 0.9,
            forceJpg: true,
          })) as { path: string; mime?: string };
        } catch (e) {
          const msg = String((e as Error)?.message ?? e);
          if (/cancel/i.test(msg)) return null;
          throw e;
        }
        const path = cropped.path;
        const uri = path.startsWith('file://') || path.startsWith('http') ? path : `file://${path}`;
        const name = uri.split('/').pop() || `avatar_${Date.now()}.jpg`;
        return await mediaService.upload({ uri, name, type: cropped.mime || 'image/jpeg' });
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
    try {
      return await new Promise<PickedLocation | null>((resolve) => {
        Geolocation.getCurrentPosition(
          (pos) =>
            resolve({
              latitude: pos.coords.latitude,
              longitude: pos.coords.longitude,
              accuracy: pos.coords.accuracy ?? null,
            }),
          (err) => {
            console.warn('[media] location failed:', err?.message);
            resolve(null);
          },
          { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 },
        );
      });
    } finally {
      setBusy(false);
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (activeRecording.current) return true;
    if (!(await ensureAndroidAudioPermission())) {
      showAlert('Micro', "L'accès au micro est nécessaire pour enregistrer.");
      return false;
    }
    try {
      const path = await audioRecorder.startRecorder();
      recordPathRef.current = path;
      activeRecording.current = true;
      setRecording(true);
      setRecordSeconds(0);
      recordSecondsRef.current = 0;
      tickRef.current = setInterval(() => {
        recordSecondsRef.current += 1;
        setRecordSeconds(recordSecondsRef.current);
      }, 1000);
      return true;
    } catch (e) {
      console.warn('[media] record start failed:', e);
      alertError('Erreur', "Impossible de démarrer l'enregistrement.");
      return false;
    }
  }, []);

  const finishRecorder = useCallback(async (): Promise<{ path: string | null; seconds: number }> => {
    const seconds = recordSecondsRef.current;
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setRecording(false);
    if (!activeRecording.current) return { path: null, seconds };
    activeRecording.current = false;
    try {
      const path = await audioRecorder.stopRecorder();
      audioRecorder.removeRecordBackListener?.();
      return { path: path || recordPathRef.current, seconds };
    } catch {
      return { path: recordPathRef.current, seconds };
    }
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
    recording,
    recordSeconds,
    pickImageLocal,
    pickVideoLocal,
    pickDocumentLocal,
    stopRecordingLocal,
    pickAvatar,
  };
}
