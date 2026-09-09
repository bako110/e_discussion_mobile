import React, { Suspense, useCallback, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useIsFocused } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';

import { AppHeader, Icon, Screen, showAlert } from '@/components/common';
import { useTheme } from '@/context/ThemeContext';
import type { MainScreenProps } from '@/navigation/types';
import { groupService } from '@/services';

import type { ScannerCameraHandle } from './ScannerCamera';

// La vue caméra est chargée à la demande : `react-native-vision-camera` n'est
// résolu que si ce lazy se monte. Si le module natif n'est pas dans le binaire
// (pas de rebuild), l'ErrorBoundary ci-dessous bascule sur la saisie manuelle.
const ScannerCamera = React.lazy(() => import('./ScannerCamera'));

/**
 * Extrait un code d'invitation d'une valeur scannée / collée.
 * Accepte : `gofolyx://join/<code>`, `https://.../join/<code>`, ou le code brut.
 */
export function parseInviteCode(raw: string): string | null {
  const v = raw.trim();
  if (!v) return null;
  const m = v.match(/(?:join\/)([A-Za-z0-9_-]{4,16})/);
  if (m) return m[1]!;
  if (/^[A-Za-z0-9_-]{4,16}$/.test(v)) return v;
  return null;
}

/** ErrorBoundary : si la caméra native est indisponible, on affiche `fallback`. */
class CameraBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown) {
    console.warn('[scanner] caméra indisponible:', e);
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

/**
 * Scanner de QR code d'invitation (groupe / chaîne).
 *
 * Caméra plein écran via `react-native-vision-camera` (chargée à la demande).
 * Si l'accès caméra est refusé ou le module natif absent, l'écran bascule sur
 * la saisie manuelle du code. Un QR encode `gofolyx://join/<invite_code>`.
 */
export const ScannerScreen: React.FC<MainScreenProps<'Scanner'>> = ({ navigation }) => {
  const { t } = useTranslation();
  const { theme } = useTheme();
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const c = theme.colors;

  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [camState, setCamState] = useState<ScannerCameraHandle>({
    hasPermission: false,
    hasDevice: false,
  });
  const handled = useRef(false);

  const resolveCode = useCallback(
    async (raw: string) => {
      if (handled.current || busy) return;
      const code = parseInviteCode(raw);
      if (!code) {
        showAlert(t('groups.invalidCode'));
        return;
      }
      handled.current = true;
      setBusy(true);
      try {
        const preview = await groupService.preview(code);
        navigation.replace('JoinPreview', { code, preview });
      } catch (e) {
        console.warn('[scan] preview failed:', e);
        showAlert(t('groups.codeNotFound'));
        handled.current = false;
      } finally {
        setBusy(false);
      }
    },
    [busy, navigation, t],
  );

  const cameraDenied = camState.hasDevice === false && camState.hasPermission === false;

  const manualEntry = (
    <View style={styles.fallback}>
      <View style={[styles.fbIcon, { backgroundColor: c.surfaceAlt }]}>
        <Icon
          name={camState.hasPermission === false ? 'camera-off-outline' : 'qrcode'}
          size={40}
          color={c.textFaint}
        />
      </View>
      <Text style={[styles.fbTitle, { color: c.text }]}>
        {camState.hasPermission === false
          ? t('groups.cameraDenied')
          : t('groups.enterCodeTitle')}
      </Text>
      <Text style={[styles.fbHint, { color: c.textMuted }]}>
        {camState.hasPermission === false
          ? t('groups.cameraDeniedHint')
          : t('groups.enterCodeHint')}
      </Text>

      {camState.hasPermission === false ? (
        <Pressable
          onPress={() => Linking.openSettings()}
          style={[styles.settingsBtn, { borderColor: c.primary }]}
        >
          <Text style={[styles.settingsText, { color: c.primary }]}>
            {t('groups.openSettings')}
          </Text>
        </Pressable>
      ) : null}

      <View style={[styles.codeBox, { backgroundColor: c.surface, borderColor: c.border }]}>
        <TextInput
          value={manual}
          onChangeText={setManual}
          placeholder={t('groups.codePlaceholder')}
          placeholderTextColor={c.textFaint}
          autoCapitalize="none"
          autoCorrect={false}
          style={[styles.codeInput, { color: c.text }]}
          onSubmitEditing={() => void resolveCode(manual)}
        />
        <Pressable
          onPress={() => void resolveCode(manual)}
          disabled={!manual.trim() || busy}
          style={[styles.goBtn, { backgroundColor: c.primary, opacity: manual.trim() && !busy ? 1 : 0.5 }]}
        >
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Icon name="arrow-right" size={18} color="#fff" />
          )}
        </Pressable>
      </View>
    </View>
  );

  const cameraReady = camState.hasPermission && camState.hasDevice && !cameraDenied;

  return (
    <Screen edges={[]}>
      <AppHeader
        variant="plain"
        title={t('groups.scanTitle')}
        left={
          <Pressable onPress={() => navigation.goBack()} hitSlop={10}>
            <Icon name="close" size={26} color={c.text} />
          </Pressable>
        }
      />

      <View style={styles.body}>
        <CameraBoundary fallback={manualEntry}>
          <Suspense
            fallback={
              <View style={styles.loading}>
                <ActivityIndicator color={c.primary} />
              </View>
            }
          >
            <View style={styles.cameraWrap}>
              <ScannerCamera
                active={isFocused && !busy}
                onScanned={(v) => void resolveCode(v)}
                onState={setCamState}
              />

              {cameraReady ? (
                <>
                  <View style={styles.frame} pointerEvents="none">
                    <View style={[styles.corner, styles.tl]} />
                    <View style={[styles.corner, styles.tr]} />
                    <View style={[styles.corner, styles.bl]} />
                    <View style={[styles.corner, styles.br]} />
                  </View>
                  <Text style={styles.hint}>{t('groups.scanHint')}</Text>
                  {busy ? (
                    <View style={styles.scanBusy}>
                      <ActivityIndicator color="#fff" />
                    </View>
                  ) : null}
                  <View style={[styles.manualBar, { paddingBottom: 10 + insets.bottom }]}>
                    <TextInput
                      value={manual}
                      onChangeText={setManual}
                      placeholder={t('groups.codePlaceholder')}
                      placeholderTextColor="#ffffff99"
                      autoCapitalize="none"
                      autoCorrect={false}
                      style={styles.manualInput}
                      onSubmitEditing={() => void resolveCode(manual)}
                    />
                    <Pressable
                      onPress={() => void resolveCode(manual)}
                      disabled={!manual.trim()}
                      style={[styles.goBtnLight, { opacity: manual.trim() ? 1 : 0.4 }]}
                    >
                      <Icon name="arrow-right" size={18} color="#12213B" />
                    </Pressable>
                  </View>
                </>
              ) : (
                // permission demandée mais pas encore accordée / pas de device
                <View style={styles.overFallback}>{manualEntry}</View>
              )}
            </View>
          </Suspense>
        </CameraBoundary>
      </View>
    </Screen>
  );
};

const FRAME = 240;

const styles = StyleSheet.create({
  body: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  cameraWrap: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center' },
  overFallback: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  frame: { width: FRAME, height: FRAME },
  corner: { position: 'absolute', width: 34, height: 34, borderColor: '#fff' },
  tl: { top: 0, left: 0, borderTopWidth: 4, borderLeftWidth: 4, borderTopLeftRadius: 8 },
  tr: { top: 0, right: 0, borderTopWidth: 4, borderRightWidth: 4, borderTopRightRadius: 8 },
  bl: { bottom: 0, left: 0, borderBottomWidth: 4, borderLeftWidth: 4, borderBottomLeftRadius: 8 },
  br: { bottom: 0, right: 0, borderBottomWidth: 4, borderRightWidth: 4, borderBottomRightRadius: 8 },
  hint: { position: 'absolute', bottom: 90, color: '#fff', fontSize: 14, fontWeight: '600' },
  scanBusy: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 24,
    paddingLeft: 16,
    paddingRight: 6,
    paddingTop: 6,
    height: 52,
  },
  manualInput: { flex: 1, color: '#fff', fontSize: 14 },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, paddingHorizontal: 32 },
  fbIcon: { width: 84, height: 84, borderRadius: 42, alignItems: 'center', justifyContent: 'center' },
  fbTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  fbHint: { fontSize: 13, textAlign: 'center', lineHeight: 19 },
  settingsBtn: { paddingHorizontal: 18, paddingVertical: 9, borderRadius: 20, borderWidth: 1.5 },
  settingsText: { fontSize: 13, fontWeight: '700' },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    width: '100%',
    height: 48,
    borderRadius: 24,
    borderWidth: 1,
    paddingLeft: 16,
    paddingRight: 6,
  },
  codeInput: { flex: 1, fontSize: 15 },
  goBtn: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  goBtnLight: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
