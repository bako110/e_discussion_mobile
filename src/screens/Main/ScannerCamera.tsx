import React, { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import {
  Camera,
  useCameraDevice,
  useCameraPermission,
  useCodeScanner,
} from 'react-native-vision-camera';

/**
 * Vue caméra + scanner QR isolée dans son propre module : `react-native-vision-camera`
 * n'est importé QUE si ce composant est rendu (via React.lazy dans ScannerScreen).
 * Ainsi l'écran parent ne plante pas quand le module natif n'est pas dans le binaire.
 */
export interface ScannerCameraHandle {
  hasPermission: boolean;
  hasDevice: boolean;
}

interface Props {
  active: boolean;
  onScanned: (value: string) => void;
  onState?: (state: ScannerCameraHandle) => void;
}

const ScannerCamera: React.FC<Props> = ({ active, onScanned, onState }) => {
  const { hasPermission, requestPermission } = useCameraPermission();
  const device = useCameraDevice('back');
  const [asked, setAsked] = useState(false);

  useEffect(() => {
    if (hasPermission || asked) return;
    setAsked(true);
    void requestPermission();
  }, [hasPermission, asked, requestPermission]);

  useEffect(() => {
    onState?.({ hasPermission, hasDevice: !!device });
  }, [hasPermission, device, onState]);

  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const value = codes?.[0]?.value;
      if (value) onScanned(String(value));
    },
  });

  if (!hasPermission || !device) return null;

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={active}
      codeScanner={codeScanner}
    />
  );
};

export default ScannerCamera;
