import { PermissionsAndroid, Platform } from 'react-native';
import Contacts from 'react-native-contacts';

import { userService } from './userService';
import type { ContactMatch } from '@/types';
import { storage } from '@/utils/storage';
import { dialFromE164, normalizeToE164 } from '@/utils/phone';

const LAST_SYNC_KEY = 'contacts.lastSyncAt';
const DONE_ONCE_KEY = 'contacts.syncedOnce';

export type ContactPermission = 'granted' | 'denied' | 'blocked' | 'undetermined';

/** Demande la permission de lire le carnet d'adresses. */
export async function requestContactsPermission(): Promise<ContactPermission> {
  if (Platform.OS === 'android') {
    try {
      const res = await PermissionsAndroid.request(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
        {
          title: 'Contacts',
          message:
            "Gofolyx a besoin d'accéder à vos contacts pour retrouver ceux qui utilisent déjà l'application.",
          buttonPositive: 'Autoriser',
          buttonNegative: 'Refuser',
        },
      );
      if (res === PermissionsAndroid.RESULTS.GRANTED) return 'granted';
      if (res === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) return 'blocked';
      return 'denied';
    } catch {
      return 'denied';
    }
  }
  // iOS
  try {
    const status = await Contacts.checkPermission();
    if (status === 'authorized') return 'granted';
    const req = await Contacts.requestPermission();
    return req === 'authorized' ? 'granted' : req === 'denied' ? 'blocked' : 'denied';
  } catch {
    return 'denied';
  }
}

export async function hasContactsPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    try {
      return await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_CONTACTS,
      );
    } catch {
      return false;
    }
  }
  try {
    return (await Contacts.checkPermission()) === 'authorized';
  } catch {
    return false;
  }
}

interface RawEntry {
  phone: string;
  display_name?: string;
}

/** Lit le carnet, normalise les numéros en E.164 (dédupliqués). */
async function readAndNormalize(userPhone: string | null): Promise<RawEntry[]> {
  const defaultDial = dialFromE164(userPhone);
  const all = await Contacts.getAll();
  const seen = new Set<string>();
  const out: RawEntry[] = [];

  for (const c of all) {
    const name =
      c.displayName ||
      [c.givenName, c.familyName].filter(Boolean).join(' ') ||
      undefined;
    for (const pn of c.phoneNumbers ?? []) {
      const e164 = normalizeToE164(pn.number ?? '', defaultDial);
      if (!e164 || seen.has(e164)) continue;
      seen.add(e164);
      out.push({ phone: e164, display_name: name });
      if (out.length >= 5000) break; // borne haute (le backend limite aussi)
    }
    if (out.length >= 5000) break;
  }
  return out;
}

export interface ContactSyncResult {
  permission: ContactPermission;
  scanned: number;
  matches: ContactMatch[];
}

/**
 * Synchronise le carnet d'adresses avec le serveur :
 *  1. demande la permission si besoin ;
 *  2. lit + normalise les numéros ;
 *  3. envoie au backend qui renvoie ceux ayant un compte Gofolyx.
 */
export async function syncPhoneContacts(opts?: {
  userPhone?: string | null;
  askPermission?: boolean;
}): Promise<ContactSyncResult> {
  let perm: ContactPermission = (await hasContactsPermission())
    ? 'granted'
    : 'undetermined';

  if (perm !== 'granted' && (opts?.askPermission ?? true)) {
    perm = await requestContactsPermission();
  }
  if (perm !== 'granted') {
    return { permission: perm, scanned: 0, matches: [] };
  }

  const entries = await readAndNormalize(opts?.userPhone ?? null);
  if (entries.length === 0) {
    storage.set(LAST_SYNC_KEY, String(Date.now()));
    storage.set(DONE_ONCE_KEY, '1');
    return { permission: perm, scanned: 0, matches: [] };
  }

  const matches = await userService.syncContacts(entries);
  storage.set(LAST_SYNC_KEY, String(Date.now()));
  storage.set(DONE_ONCE_KEY, '1');
  return { permission: perm, scanned: entries.length, matches };
}

/** Vrai si aucune synchro n'a jamais été faite (pour la proposer au 1er lancement). */
export function neverSyncedContacts(): boolean {
  try {
    return storage.getString(DONE_ONCE_KEY) !== '1';
  } catch {
    return true;
  }
}

export function lastContactsSyncAt(): number | null {
  try {
    const v = storage.getString(LAST_SYNC_KEY);
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}
