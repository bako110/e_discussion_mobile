/**
 * Recadrage d'image — style éditeur Android natif :
 *  - l'image reste FIXE (affichée en entier),
 *  - un cadre ajustable par-dessus : 4 poignées de coin + glisser le centre ;
 *    par défaut il couvre TOUTE l'image,
 *  - au valider, on découpe EXACTEMENT la zone du cadre. L'original est intact.
 *
 * C'est un ÉCRAN de navigation (`ImageCrop`) — pas un overlay racine : sinon,
 * sous un native-stack, il passe derrière l'écran courant et ne reçoit aucun
 * geste.
 *
 * API impérative :
 *   import { openCrop } from '@/components/common/CropModal';
 *   const res = await openCrop(uri, { circle: true });
 *   if (res) upload(res.uri);
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  LayoutChangeEvent,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ImageEditor from '@react-native-community/image-editor';

import type { MainScreenProps } from '@/navigation/types';
import { navigationRef } from '@/navigation/navigationRef';

import { Icon } from './Icon';

export interface CropModalResult {
  uri: string;
  width: number;
  height: number;
}

export interface CropModalOpts {
  /** Cadre carré + rendu circulaire (avatar). */
  circle?: boolean;
  /** Ratio largeur/hauteur imposé au cadre. `circle` force 1. Sinon libre. */
  aspect?: number;
  title?: string;
}

// ── pont impératif <-> écran de navigation ──────────────────────────────
const _pending = new Map<string, (r: CropModalResult | null) => void>();
let _seq = 0;

/** Ouvre l'écran de recadrage. Résout `null` si l'utilisateur annule. */
export function openCrop(uri: string, opts: CropModalOpts = {}): Promise<CropModalResult | null> {
  return new Promise((resolve) => {
    if (!navigationRef.isReady()) {
      resolve(null);
      return;
    }
    const token = `crop_${Date.now()}_${_seq++}`;
    _pending.set(token, resolve);
    navigationRef.navigate('ImageCrop', {
      token,
      uri,
      circle: opts.circle,
      aspect: opts.aspect,
      title: opts.title,
    });
  });
}

function resolveCrop(token: string, r: CropModalResult | null): void {
  const fn = _pending.get(token);
  if (fn) {
    _pending.delete(token);
    fn(r);
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const MIN = 56;
const HANDLE = 44;

type Rect = { x: number; y: number; w: number; h: number };
type Handle = 'tl' | 'tr' | 'bl' | 'br' | 'move';

export const ImageCropScreen: React.FC<MainScreenProps<'ImageCrop'>> = ({ route, navigation }) => {
  const { token, uri, circle, title } = route.params;
  const aspect = circle ? 1 : route.params.aspect;
  const insets = useSafeAreaInsets();

  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [stage, setStage] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  const dispUri = /^(content:|file:|http|data:)/.test(uri) ? uri : `file://${uri}`;

  // renvoi vers l'appelant : une seule fois, y compris si on quitte par le back
  const answered = useRef(false);
  const answer = useCallback(
    (r: CropModalResult | null) => {
      if (answered.current) return;
      answered.current = true;
      resolveCrop(token, r);
    },
    [token],
  );
  useEffect(() => {
    // back matériel / geste : on répond `null`
    return navigation.addListener('beforeRemove', () => answer(null));
  }, [navigation, answer]);

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

  const imgBox = useMemo<Rect | null>(() => {
    if (!natural || stage.w <= 0 || stage.h <= 0) return null;
    const s = Math.min(stage.w / natural.w, stage.h / natural.h);
    const w = natural.w * s;
    const h = natural.h * s;
    return { x: (stage.w - w) / 2, y: (stage.h - h) / 2, w, h };
  }, [natural, stage]);

  const [crop, setCrop] = useState<Rect | null>(null);
  const cropRef = useRef<Rect | null>(null);
  const setCropBoth = useCallback((r: Rect) => {
    cropRef.current = r;
    setCrop(r);
  }, []);

  useEffect(() => {
    if (!imgBox) return;
    let w = imgBox.w;
    let h = imgBox.h;
    if (aspect && aspect > 0) {
      if (w / h > aspect) w = h * aspect;
      else h = w / aspect;
    }
    setCropBoth({
      x: imgBox.x + (imgBox.w - w) / 2,
      y: imgBox.y + (imgBox.h - h) / 2,
      w,
      h,
    });
  }, [imgBox, aspect, setCropBoth]);

  const dragStart = useRef<{ rect: Rect; handle: Handle } | null>(null);
  const imgBoxRef = useRef<Rect | null>(null);
  imgBoxRef.current = imgBox;

  const applyDrag = useCallback(
    (dx: number, dy: number) => {
      const st = dragStart.current;
      const box = imgBoxRef.current;
      if (!st || !box) return;
      const b = st.rect;
      const minX = box.x;
      const minY = box.y;
      const maxX = box.x + box.w;
      const maxY = box.y + box.h;

      if (st.handle === 'move') {
        setCropBoth({
          x: clamp(b.x + dx, minX, maxX - b.w),
          y: clamp(b.y + dy, minY, maxY - b.h),
          w: b.w,
          h: b.h,
        });
        return;
      }

      let left = b.x;
      let top = b.y;
      let right = b.x + b.w;
      let bottom = b.y + b.h;
      if (st.handle === 'tl') {
        left = clamp(b.x + dx, minX, right - MIN);
        top = clamp(b.y + dy, minY, bottom - MIN);
      } else if (st.handle === 'tr') {
        right = clamp(right + dx, left + MIN, maxX);
        top = clamp(b.y + dy, minY, bottom - MIN);
      } else if (st.handle === 'bl') {
        left = clamp(b.x + dx, minX, right - MIN);
        bottom = clamp(bottom + dy, top + MIN, maxY);
      } else if (st.handle === 'br') {
        right = clamp(right + dx, left + MIN, maxX);
        bottom = clamp(bottom + dy, top + MIN, maxY);
      }

      let w = right - left;
      let h = bottom - top;
      if (aspect && aspect > 0) {
        h = w / aspect;
        if (st.handle === 'tl' || st.handle === 'tr') top = bottom - h;
        else bottom = top + h;
        if (top < minY || bottom > maxY) {
          h = clamp(h, MIN, maxY - minY);
          w = h * aspect;
          if (st.handle === 'tl') {
            left = right - w;
            top = bottom - h;
          } else if (st.handle === 'tr') {
            right = left + w;
            top = bottom - h;
          } else if (st.handle === 'bl') {
            left = right - w;
            bottom = top + h;
          } else {
            right = left + w;
            bottom = top + h;
          }
        }
      }
      setCropBoth({ x: left, y: top, w: right - left, h: bottom - top });
    },
    [aspect, setCropBoth],
  );

  const makeResponder = useCallback(
    (handle: Handle) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const r = cropRef.current;
          if (r) dragStart.current = { rect: { ...r }, handle };
        },
        onPanResponderMove: (_e, g) => applyDrag(g.dx, g.dy),
        onPanResponderRelease: () => {
          dragStart.current = null;
        },
        onPanResponderTerminate: () => {
          dragStart.current = null;
        },
      }),
    [applyDrag],
  );

  const moveResp = useMemo(() => makeResponder('move'), [makeResponder]);
  const tlResp = useMemo(() => makeResponder('tl'), [makeResponder]);
  const trResp = useMemo(() => makeResponder('tr'), [makeResponder]);
  const blResp = useMemo(() => makeResponder('bl'), [makeResponder]);
  const brResp = useMemo(() => makeResponder('br'), [makeResponder]);

  const onStageLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setStage({ w: width, h: height });
  };

  const finish = (r: CropModalResult | null) => {
    answer(r);
    navigation.goBack();
  };

  const confirm = async () => {
    const c = cropRef.current;
    if (busy || !natural || !imgBox || !c) return;
    setBusy(true);
    try {
      const kx = natural.w / imgBox.w;
      const ky = natural.h / imgBox.h;
      const offset = {
        x: clamp((c.x - imgBox.x) * kx, 0, natural.w - 1),
        y: clamp((c.y - imgBox.y) * ky, 0, natural.h - 1),
      };
      const size = {
        width: clamp(c.w * kx, 1, natural.w - offset.x),
        height: clamp(c.h * ky, 1, natural.h - offset.y),
      };
      const outW = circle ? 512 : Math.round(size.width);
      const outH = circle ? 512 : Math.round(size.height);
      const res = await ImageEditor.cropImage(dispUri, {
        offset,
        size,
        displaySize: circle ? { width: 512, height: 512 } : undefined,
        format: 'jpeg',
        quality: 0.9,
      });
      const path = res.uri || res.path;
      const outUri =
        path.startsWith('file://') || path.startsWith('content://') ? path : `file://${path}`;
      finish({ uri: outUri, width: outW, height: outH });
    } catch (e) {
      console.warn('[ImageCrop] crop failed:', e);
      finish(null);
    } finally {
      setBusy(false);
    }
  };

  const ready = !!natural && !!imgBox && !!crop;

  return (
    <View style={styles.root}>
      <View style={[styles.bar, { paddingTop: insets.top + 6 }]}>
        <Pressable onPress={() => finish(null)} hitSlop={12} style={styles.barBtn}>
          <Icon name="close" size={26} color="#fff" />
        </Pressable>
        <Text style={styles.barTitle}>{title ?? 'Recadrer'}</Text>
        <Pressable onPress={confirm} hitSlop={12} style={styles.barBtn} disabled={busy || !ready}>
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
        ) : !ready ? (
          <ActivityIndicator color="#fff" size="large" />
        ) : (
          <>
            <Image source={{ uri: dispUri }} resizeMode="contain" style={StyleSheet.absoluteFill} />

            <View pointerEvents="none" style={StyleSheet.absoluteFill}>
              <View style={[styles.veil, { left: 0, right: 0, top: 0, height: crop!.y }]} />
              <View style={[styles.veil, { left: 0, right: 0, top: crop!.y + crop!.h, bottom: 0 }]} />
              <View style={[styles.veil, { left: 0, width: crop!.x, top: crop!.y, height: crop!.h }]} />
              <View
                style={[styles.veil, { right: 0, left: crop!.x + crop!.w, top: crop!.y, height: crop!.h }]}
              />
            </View>

            <View
              {...moveResp.panHandlers}
              style={[
                styles.frame,
                {
                  left: crop!.x,
                  top: crop!.y,
                  width: crop!.w,
                  height: crop!.h,
                  borderRadius: circle ? crop!.w / 2 : 0,
                },
              ]}
            >
              <View style={[styles.grid, styles.gridV, { left: '33.33%' }]} />
              <View style={[styles.grid, styles.gridV, { left: '66.66%' }]} />
              <View style={[styles.grid, styles.gridH, { top: '33.33%' }]} />
              <View style={[styles.grid, styles.gridH, { top: '66.66%' }]} />
            </View>

            <View {...tlResp.panHandlers} style={[styles.handle, { left: crop!.x - 20, top: crop!.y - 20 }]}>
              <View style={[styles.corner, styles.cornerTL]} />
            </View>
            <View
              {...trResp.panHandlers}
              style={[styles.handle, { left: crop!.x + crop!.w - HANDLE + 20, top: crop!.y - 20 }]}
            >
              <View style={[styles.corner, styles.cornerTR]} />
            </View>
            <View
              {...blResp.panHandlers}
              style={[styles.handle, { left: crop!.x - 20, top: crop!.y + crop!.h - HANDLE + 20 }]}
            >
              <View style={[styles.corner, styles.cornerBL]} />
            </View>
            <View
              {...brResp.panHandlers}
              style={[
                styles.handle,
                { left: crop!.x + crop!.w - HANDLE + 20, top: crop!.y + crop!.h - HANDLE + 20 },
              ]}
            >
              <View style={[styles.corner, styles.cornerBR]} />
            </View>
          </>
        )}
      </View>

      <Text style={[styles.hint, { paddingBottom: insets.bottom + 12 }]}>
        Ajustez le cadre sur la zone à garder
      </Text>
    </View>
  );
};

const styles = StyleSheet.create({
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
  stage: { flex: 1, overflow: 'hidden' },
  veil: { position: 'absolute', backgroundColor: 'rgba(0,0,0,0.6)' },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: '#fff' },
  grid: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  gridV: { top: 0, bottom: 0, width: StyleSheet.hairlineWidth },
  gridH: { left: 0, right: 0, height: StyleSheet.hairlineWidth },
  handle: {
    position: 'absolute',
    width: HANDLE,
    height: HANDLE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  corner: { width: 22, height: 22, borderColor: '#fff' },
  cornerTL: { borderLeftWidth: 3, borderTopWidth: 3 },
  cornerTR: { borderRightWidth: 3, borderTopWidth: 3 },
  cornerBL: { borderLeftWidth: 3, borderBottomWidth: 3 },
  cornerBR: { borderRightWidth: 3, borderBottomWidth: 3 },
  hint: { color: '#ffffffcc', fontSize: 13, textAlign: 'center', paddingTop: 10 },
  errText: { color: '#fff', fontSize: 15, textAlign: 'center', marginTop: 40 },
});
