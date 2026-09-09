/**
 * Préférences des appels (locales, MMKV).
 *
 *  - ringtone        : sonnerie des appels entrants ('default' | 'classic' | 'soft')
 *  - vibrate         : vibreur à la sonnerie
 *  - answerOnSpeaker : décrocher direct en haut-parleur
 *  - lowData         : mode données réduites (vidéo désactivée par défaut,
 *                      la bascule vidéo reste possible manuellement)
 *  - blockUnknown    : refuser automatiquement les appels de non-contacts
 *
 * Ces préférences sont lues par CallContext (comportement à la connexion) et
 * par les écrans d'appel.
 */
import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { storage } from '@/utils/storage';

export type Ringtone = 'default' | 'classic' | 'soft';

export interface CallPrefs {
  ringtone: Ringtone;
  vibrate: boolean;
  answerOnSpeaker: boolean;
  lowData: boolean;
  blockUnknown: boolean;
}

const K = {
  ringtone: 'calls.ringtone',
  vibrate: 'calls.vibrate',
  answerOnSpeaker: 'calls.answerOnSpeaker',
  lowData: 'calls.lowData',
  blockUnknown: 'calls.blockUnknown',
} as const;

const DEFAULTS: CallPrefs = {
  ringtone: 'default',
  vibrate: true,
  answerOnSpeaker: false,
  lowData: false,
  blockUnknown: false,
};

function read(): CallPrefs {
  const rt = storage.getString(K.ringtone);
  return {
    ringtone: rt === 'classic' || rt === 'soft' ? rt : 'default',
    vibrate: storage.getBoolean(K.vibrate) ?? DEFAULTS.vibrate,
    answerOnSpeaker: storage.getBoolean(K.answerOnSpeaker) ?? DEFAULTS.answerOnSpeaker,
    lowData: storage.getBoolean(K.lowData) ?? DEFAULTS.lowData,
    blockUnknown: storage.getBoolean(K.blockUnknown) ?? DEFAULTS.blockUnknown,
  };
}

interface CallPrefsValue extends CallPrefs {
  setRingtone: (v: Ringtone) => void;
  setVibrate: (v: boolean) => void;
  setAnswerOnSpeaker: (v: boolean) => void;
  setLowData: (v: boolean) => void;
  setBlockUnknown: (v: boolean) => void;
}

const Ctx = createContext<CallPrefsValue | null>(null);

export const CallPrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [prefs, setPrefs] = useState<CallPrefs>(read);

  const update = useCallback(<K2 extends keyof CallPrefs>(key: K2, value: CallPrefs[K2]) => {
    storage.set(K[key], value as string | number | boolean);
    setPrefs((p) => ({ ...p, [key]: value }));
  }, []);

  const value = useMemo<CallPrefsValue>(
    () => ({
      ...prefs,
      setRingtone: (v) => update('ringtone', v),
      setVibrate: (v) => update('vibrate', v),
      setAnswerOnSpeaker: (v) => update('answerOnSpeaker', v),
      setLowData: (v) => update('lowData', v),
      setBlockUnknown: (v) => update('blockUnknown', v),
    }),
    [prefs, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useCallPrefs(): CallPrefsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCallPrefs must be used within CallPrefsProvider');
  return ctx;
}

/** Lecture directe (hors React) — utilisée par le handler de notif background. */
export function readCallPrefs(): CallPrefs {
  return read();
}
