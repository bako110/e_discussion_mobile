/**
 * Recadrage d'image EN JS — plein écran, glisser + pincer sur un cadre fixe.
 *
 * Indépendant de `react-native-image-crop-picker` (qui exige un build natif à
 * jour) : le découpage pixel final passe par `@react-native-community/image-editor`.
 *
 * API impérative :
 *
 *   import { openCrop } from '@/components/common';
 *   const res = await openCrop(uri, { circle: true, aspect: 1 });
 *   if (res) upload(res.uri);
 *
 * `<CropModalHost />` doit être monté une fois au sommet de l'app.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Dimensions,
  Image,
  LayoutChangeEvent,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageEditor from '@react-native-community/image-editor';

import { Icon } from './Icon';

export interface CropModalResult {
  uri: string;
  width: number;
  height: number;
}

export interface CropModalOpts {
  /** Overlay circulaire (avatar). Force `aspect = 1`. */
  circle?: boolean;
  /** Ratio largeur/hauteur du cadre. Défaut : libre (suit l'écran). */
  aspect?: number;
  title?: string;
}

interface Job {
  uri: string;
  opts: CropModalOpts;
  resolve: (r: CropModalResult | null) => void;
}

let _emit: ((job: Job) => void) | null = null;

/** Ouvre l'éditeur de recadrage. Résout `null` si l'utilisateur annule. */
export function openCrop(uri: string, opts: CropModalOpts = {}): Promise<CropModalResult | null> {
  return new Promise((resolve) => {
    if (_emit) _emit({ uri, opts, resolve });
    else resolve(null);
  });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const CropModal: React.FC<{ job: Job; onDone: (r: CropModalResult | null) => void }> = ({
  job,
  onDone,
}) => {
  const insets = useSafeAreaInsets();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const dispUri = /^(content:|file:|http|data:)/.test(job.uri) ? job.uri : `file://${job.uri}`;

  useEffect(() => {
    let alive = true;
    Image.getSize(
      dispUri,
      (w, h) => alive && setNatural({ w, h }),
      () => alive && setErr(true),
    );
    return () => {
      alive = false;
    };
  }, [dispUri]);

  // Cadre de recadrage (fixe, centré dans le stage)
  const frame = useMemo(() => {
    if (stage.w <= 0 || stage.h <= 0) return null;
    const pad = 16;
    const maxW = stage.w - pad * 2;
    const maxH = stage.h - pad * 2;
    const aspect = job.opts.circle ? 1 : job.opts.aspect;
    let w = maxW;
    let h = maxH;
    if (aspect && aspect > 0) {
      if (maxW / maxH > aspect) w = maxH * aspect;
      else h = maxW / aspect;
    }
    return { w, h, x: (stage.w - w) / 2, y: (stage.h - h) / 2 };
  }, [stage, job.opts.circle, job.opts.aspect]);

  // Image affichée « couvrant » le cadre au minimum (base scale = cover)
  const baseFit = useMemo(() => {
    if (!natural || !frame) return null;
    const cover = Math.max(frame.w / natural.w, frame.h / natural.h);
    return { w: natural.w * cover, h: natural.h * cover, cover };
  }, [natural, frame]);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);

  // Bornes de translation : l'image doit toujours couvrir le cadre.
  const clampToBounds = useCallback(() => {
    'worklet';
    if (!baseFit || !frame) return;
    const imgW = baseFit.w * scale.value;
    const imgH = baseFit.h * scale.value;
    const maxX = Math.max(0, (imgW - frame.w) / 2);
    const maxY = Math.max(0, (imgH - frame.h) / 2);
    tx.value = clamp(tx.value, -maxX, maxX);
    ty.value = clamp(ty.value, -maxY, maxY);
  }, [baseFit, frame, scale, tx, ty]);

  const pan = Gesture.Pan()
    .onStart(() => {
      savedTx.value = tx.value;
      savedTy.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = savedTx.value + e.translationX;
      ty.value = savedTy.value + e.translationY;
    })
    .onEnd(() => clampToBounds());

  const pinch = Gesture.Pinch()
    .onStart(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = clamp(savedScale.value * e.scale, 1, 6);
    })
    .onEnd(() => clampToBounds());

  const gesture = Gesture.Simultaneous(pan, pinch);

  const imgStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ w: width, h: height });
  };

  const cancel = () => onDone(null);

  const confirm = async () => {
    if (busy || !natural || !baseFit || !frame) return;
    setBusy(true);
    try {
      // Passe de l'espace écran -> espace image d'origine.
      // px_image = px_ecran / (cover * scale)
      const k = baseFit.cover * scale.value;
      const imgW = baseFit.w * scale.value;
      const imgH = baseFit.h * scale.value;
      // coin haut-gauche du cadre dans l'image affichée (origine = centre)
      const left = (imgW - frame.w) / 2 - tx.value;
      const top = (imgH - frame.h) / 2 - ty.value;
      const offset = {
        x: clamp(left / k, 0, natural.w),
        y: clamp(top / k, 0, natural.h),
      };
      const size = {
        width: clamp(frame.w / k, 1, natural.w - offset.x),
        height: clamp(frame.h / k, 1, natural.h - offset.y),
      };
      const out = job.opts.circle ? 512 : Math.round(size.width);
      const res = await ImageEditor.cropImage(dispUri, {
        offset,
        size,
        displaySize: job.opts.circle ? { width: 512, height: 512 } : undefined,
        format: 'jpeg',
        quality: 0.9,
      });
      const uri = res.uri || (res.path.startsWith('file://') ? res.path : `file://${res.path}`);
      onDone({ uri, width: out, height: job.opts.circle ? out : Math.round(size.height) });
    } catch (e) {
      console.warn('[CropModal] crop failed:', e);
      onDone(null);
    } finally {
      setBusy(false);
    }
  };

  const win = Dimensions.get('window');

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={cancel} hitSlop={12} style={styles.barBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.barTitle}>{job.opts.title ?? 'Recadrer'}</Text>
        <Pressable onPress={confirm} hitSlop={12} style={styles.barBtn} disabled={busy}>
          {busy ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Icon name="check" size={26} color="#fff" />
          )}
        </Pressable>
      </View>

      <View style={styles.stage} onLayout={onStageLayout}>
        {err ? (
          <Text style={styles.errText}>Image illisible</Text>
        ) : !natural || !baseFit || !frame ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : (
          <GestureDetector gesture={gesture}>
            <View style={StyleSheet.absoluteFill}>
              <Animated.Image
                source={{ uri: dispUri }}
                resizeMode="cover"
                style={[
                  {
                    position: 'absolute',
                    left: (stage.w - baseFit.w) / 2,
                    top: (stage.h - baseFit.h) / 2,
                    width: baseFit.w,
                    height: baseFit.h,
                  },
                  imgStyle,
                ]}
              />
              {/* Masque sombre + trou du cadre */}
              <View style={StyleSheet.absoluteFill} pointerEvents="none">
                <View style={[styles.mask, { height: frame.y }]} />
                <View style={{ flexDirection: 'row', height: frame.h }}>
                  <View style={[styles.mask, { width: frame.x }]} />
                  <View
                    style={[
                      styles.hole,
                      {
                        width: frame.w,
                        height: frame.h,
                        borderRadius: job.opts.circle ? frame.w / 2 : 4,
                      },
                    ]}
                  />
                  <View style={[styles.mask, { width: frame.x }]} />
                </View>
                <View style={[styles.mask, { flex: 1 }]} />
              </View>
            </View>
          </GestureDetector>
        )}
      </View>

      <Text style={[styles.hint, { paddingBottom: insets.bottom + 12, width: win.width }]}>
        Glissez et pincez pour ajuster
      </Text>
    </View>
  );
};

export const CropModalHost: React.FC = () => {
  const [job, setJob] = useState<Job | null>(null);
  const opacity = useSharedValue(0);
  const resolver = useRef<((r: CropModalResult | null) => void) | null>(null);

  useEffect(() => {
    _emit = (j) => {
      resolver.current = j.resolve;
      setJob(j);
      opacity.value = withTiming(1, { duration: 150 });
    };
    return () => {
      _emit = null;
    };
  }, [opacity]);

  const done = useCallback(
    (r: CropModalResult | null) => {
      opacity.value = withTiming(0, { duration: 150 }, (finished) => {
        if (finished) runOnJS(setJob)(null);
      });
      resolver.current?.(r);
      resolver.current = null;
    },
    [opacity],
  );

  const style = useAnimatedStyle(() => ({ opacity: opacity.value }));

  if (!job) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, style]}>
      <CropModal job={job} onDone={done} />
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  overlay: { zIndex: 9999, elevation: 9999 },
  root: { flex: 1, backgroundColor: '#000' },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 10,
    paddingBottom: 8,
  },
  barBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  barTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  stage: { flex: 1, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  mask: { backgroundColor: 'rgba(0,0,0,0.62)' },
  hole: { borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  hint: { color: '#ffffffcc', fontSize: 13, textAlign: 'center', paddingTop: 10 },
  errText: { color: '#fff', fontSize: 15 },
});
