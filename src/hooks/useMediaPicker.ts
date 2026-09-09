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

import type { UploadFile } from '@/api';
import { mediaService, type UploadedMedia } from '@/services';

/**
 * Sélection & upload de médias — galerie / caméra (photo, vidéo) + note vocale.
 * Nécessite un build natif à jour (`react-native-image-picker`,
 * `react-native-audio-recorder-player`).
 */

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
  startRecording: () => Promise<boolean>;
  stopRecording: () => Promise<UploadedMedia | null>;
  cancelRecording: () => Promise<void>;
  recording: boolean;
  recordSeconds: number;
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

export function useMediaPicker(): MediaPicker {
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
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
      tickRef.current = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
      return true;
    } catch (e) {
      console.warn('[media] record start failed:', e);
      alertError('Erreur', "Impossible de démarrer l'enregistrement.");
      return false;
    }
  }, []);

  const finishRecorder = useCallback(async (): Promise<string | null> => {
    if (tickRef.current) clearInterval(tickRef.current);
    tickRef.current = null;
    setRecording(false);
    if (!activeRecording.current) return null;
    activeRecording.current = false;
    try {
      const path = await audioRecorder.stopRecorder();
      audioRecorder.removeRecordBackListener?.();
      return path || recordPathRef.current;
    } catch {
      return recordPathRef.current;
    }
  }, []);

  const stopRecording = useCallback(async (): Promise<UploadedMedia | null> => {
    const path = await finishRecorder();
    if (!path) return null;
    setBusy(true);
    try {
      const uri =
        path.startsWith('file://') || path.startsWith('http') ? path : `file://${path}`;
      const name = uri.split('/').pop() || `voice_${Date.now()}.m4a`;
      return await mediaService.upload({ uri, name, type: 'audio/mp4' });
    } catch (e) {
      console.warn('[media] record upload failed:', e);
      alertError('Erreur', "L'envoi de la note vocale a échoué.");
      return null;
    } finally {
      setBusy(false);
    }
  }, [finishRecorder]);

  const cancelRecording = useCallback(async () => {
    await finishRecorder();
  }, [finishRecorder]);

  return {
    busy,
    pickImage,
    pickVideo,
    startRecording,
    stopRecording,
    cancelRecording,
    recording,
    recordSeconds,
  };
}
