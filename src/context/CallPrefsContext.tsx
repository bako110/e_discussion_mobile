/**
 * Préférences des appels — SYNCHRONISÉES avec le serveur (champs `call_*` du
 * profil) + cache MMKV local pour un accès instantané / hors-ligne.
 *
 *  - ringtone        : sonnerie des appels entrants ('default' | 'classic' | 'soft')
 *  - vibrate         : vibreur à la sonnerie
 *  - answerOnSpeaker : décrocher direct en haut-parleur
 *  - lowData         : mode données réduites (vidéo coupée par défaut)
 *  - blockUnknown    : refuser les appels de non-contacts (appliqué AUSSI
 *                      côté serveur : l'appel ne sonne même pas)
 *
 * Lues par CallContext (comportement à la connexion + blocage) et les écrans.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@/context/AuthContext';
import { userService } from '@/services';
import type { Ringtone } from '@/types';
import { storage } from '@/utils/storage';

export type { Ringtone };

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

// mapping pref locale <-> champ serveur
const FIELD: Record<keyof CallPrefs, keyof import('@/types').UserMe> = {
  ringtone: 'call_ringtone',
  vibrate: 'call_vibrate',
  answerOnSpeaker: 'call_answer_on_speaker',
  lowData: 'call_low_data',
  blockUnknown: 'call_block_unknown',
};

function readCache(): CallPrefs {
  const rt = storage.getString(K.ringtone);
  return {
    ringtone: rt === 'classic' || rt === 'soft' ? rt : 'default',
    vibrate: storage.getBoolean(K.vibrate) ?? DEFAULTS.vibrate,
    answerOnSpeaker: storage.getBoolean(K.answerOnSpeaker) ?? DEFAULTS.answerOnSpeaker,
    lowData: storage.getBoolean(K.lowData) ?? DEFAULTS.lowData,
    blockUnknown: storage.getBoolean(K.blockUnknown) ?? DEFAULTS.blockUnknown,
  };
}

function writeCache(p: CallPrefs) {
  storage.set(K.ringtone, p.ringtone);
  storage.set(K.vibrate, p.vibrate);
  storage.set(K.answerOnSpeaker, p.answerOnSpeaker);
  storage.set(K.lowData, p.lowData);
  storage.set(K.blockUnknown, p.blockUnknown);
}

interface CallPrefsValue extends CallPrefs {
  /** true tant que la 1re synchro serveur n'a pas eu lieu. */
  loading: boolean;
  setRingtone: (v: Ringtone) => void;
  setVibrate: (v: boolean) => void;
  setAnswerOnSpeaker: (v: boolean) => void;
  setLowData: (v: boolean) => void;
  setBlockUnknown: (v: boolean) => void;
}

const Ctx = createContext<CallPrefsValue | null>(null);

export const CallPrefsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { me } = useAuth();
  const [prefs, setPrefs] = useState<CallPrefs>(readCache);
  const [loading, setLoading] = useState(true);
  const hydratedFor = useRef<string | null>(null);

  // hydrate depuis le profil serveur dès qu'il est disponible
  useEffect(() => {
    if (!me) {
      setLoading(true);
      return;
    }
    if (hydratedFor.current === me.id) return;
    hydratedFor.current = me.id;
    const server: CallPrefs = {
      ringtone: me.call_ringtone ?? DEFAULTS.ringtone,
      vibrate: me.call_vibrate ?? DEFAULTS.vibrate,
      answerOnSpeaker: me.call_answer_on_speaker ?? DEFAULTS.answerOnSpeaker,
      lowData: me.call_low_data ?? DEFAULTS.lowData,
      blockUnknown: me.call_block_unknown ?? DEFAULTS.blockUnknown,
    };
    setPrefs(server);
    writeCache(server);
    setLoading(false);
  }, [me]);

  // write-through : MAJ optimiste locale + PATCH serveur (retour arrière si échec)
  const update = useCallback(
    <K2 extends keyof CallPrefs>(key: K2, value: CallPrefs[K2]) => {
      setPrefs((p) => {
        const nextPrefs = { ...p, [key]: value };
        writeCache(nextPrefs);
        return nextPrefs;
      });
      // updateMe est local-first : optimiste + outbox `update_me` -> rejoué
      // automatiquement au retour du réseau.
      void userService.updateMe({ [FIELD[key]]: value } as Record<string, unknown>).catch(
        () => undefined,
      );
    },
    [],
  );

  const value = useMemo<CallPrefsValue>(
    () => ({
      ...prefs,
      loading,
      setRingtone: (v) => update('ringtone', v),
      setVibrate: (v) => update('vibrate', v),
      setAnswerOnSpeaker: (v) => update('answerOnSpeaker', v),
      setLowData: (v) => update('lowData', v),
      setBlockUnknown: (v) => update('blockUnknown', v),
    }),
    [prefs, loading, update],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export function useCallPrefs(): CallPrefsValue {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCallPrefs must be used within CallPrefsProvider');
  return ctx;
}

/** Lecture directe (hors React) — handler de notif background. */
export function readCallPrefs(): CallPrefs {
  return readCache();
}
