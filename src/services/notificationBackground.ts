/**
 * Handler de notifications en arrière-plan / app fermée (contexte JS headless).
 *
 * DOIT rester autonome : pas d'import de contextes React, de navigation, ni de
 * la Room LiveKit. On se contente de :
 *  - « Refuser » : appeler l'endpoint reject directement + retirer la sonnerie ;
 *  - « Répondre » : appeler l'endpoint accept DIRECTEMENT depuis ce contexte
 *    headless (voir acceptRemote ci-dessous), puis laisser `launchActivity`
 *    ouvrir l'app — CallContext lit le résultat déjà obtenu au démarrage ;
 *  - tap simple sur le corps : juste ramener l'app, sans rien accepter ;
 *  - balayage de la notif : retirer la sonnerie.
 *
 * Pourquoi accepter ICI et pas seulement stocker l'intention : un appel HTTP
 * direct réussit en general en moins d'une seconde, alors qu'un cold start
 * complet de l'app (JS bundle + tous les providers React) peut prendre
 * 10+ secondes sur un appareil lent — largement plus que ce qu'un appelant
 * humain attend avant d'abandonner et de raccrocher lui-même. Accepter tout
 * de suite ici marque l'appel `active` côté serveur en ~1s, ce qui empêche
 * ce raccroché prématuré ; l'app n'a alors "plus qu'à" rejoindre la room
 * LiveKit avec le token déjà en poche, sans dépendre de son temps de démarrage.
 */
import notifee, { EventType } from '@notifee/react-native';
import { MMKV } from 'react-native-mmkv';
import * as Keychain from 'react-native-keychain';

import { API_BASE_URL } from '@/utils/constants';
import { Endpoints } from '@/api';
import { INCOMING_CALL_NOTIF_ID } from './notificationService';

const store = new MMKV({ id: 'call-intents' });
const PENDING_KEY = 'pending.accept.callId';
/** Réponse complète de POST /calls/{id}/accept, obtenue en headless — évite
 * à CallContext de refaire l'appel HTTP (et d'attendre le cold start) au
 * démarrage de l'app. */
const PENDING_RESULT_KEY = 'pending.accept.result';

export interface PendingAcceptResult {
  callId: string;
  livekit_url: string;
  token: string;
  room_name: string;
  call_type: string;
  e2ee_key: string | null;
  peer: unknown;
}

/** L'app relit ceci au démarrage (CallContext) pour accepter automatiquement.
 * Ne renvoie qu'un callId : soit l'accept headless n'a jamais été tenté
 * (tap sur le corps, pas le bouton), soit il a échoué et l'app doit refaire
 * l'appel elle-même. Voir `takePendingAcceptResult` pour le cas nominal. */
export function takePendingAcceptCallId(): string | null {
  const v = store.getString(PENDING_KEY) ?? null;
  if (v) store.delete(PENDING_KEY);
  return v;
}

export function setPendingAcceptCallId(callId: string): void {
  store.set(PENDING_KEY, callId);
}

/** Résultat déjà obtenu par accept() en headless — prioritaire sur
 * `takePendingAcceptCallId` : si présent, CallContext peut rejoindre la room
 * directement sans repasser par le réseau. */
export function takePendingAcceptResult(): PendingAcceptResult | null {
  const raw = store.getString(PENDING_RESULT_KEY);
  if (!raw) return null;
  store.delete(PENDING_RESULT_KEY);
  try {
    return JSON.parse(raw) as PendingAcceptResult;
  } catch {
    return null;
  }
}

function setPendingAcceptResult(result: PendingAcceptResult): void {
  store.set(PENDING_RESULT_KEY, JSON.stringify(result));
}

/** Coup d'œil SANS consommer : sert juste à savoir si un résultat est en
 * attente (déclenche tryAutoAccept), sans le retirer du stockage — la
 * vraie lecture/consommation se fait ensuite via `takePendingAcceptResult`. */
export function peekPendingAcceptResult(): string | null {
  const raw = store.getString(PENDING_RESULT_KEY);
  if (!raw) return null;
  try {
    return (JSON.parse(raw) as PendingAcceptResult).callId;
  } catch {
    return null;
  }
}

const KEYCHAIN_SERVICE = 'ediscussion-auth-tokens';

async function currentAccessToken(): Promise<string | null> {
  try {
    const creds = await Keychain.getGenericPassword({ service: KEYCHAIN_SERVICE });
    if (!creds || !creds.password) return null;
    return (JSON.parse(creds.password) as { access: string }).access ?? null;
  } catch {
    return null;
  }
}

async function rejectRemote(callId: string): Promise<void> {
  try {
    const token = await currentAccessToken();
    if (!token) return;
    await fetch(`${API_BASE_URL}${Endpoints.calls.reject(callId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
  } catch {
    /* le timeout de sonnerie serveur basculera l'appel en "missed" */
  }
}

/** Accepte l'appel DIRECTEMENT depuis le contexte headless, sans attendre le
 * démarrage complet de l'app — voir le commentaire d'en-tête du fichier
 * pour le pourquoi. En cas d'échec (pas de token, réseau, appel déjà
 * terminé...), retombe sur l'ancien comportement : CallContext refera
 * l'appel lui-même via `takePendingAcceptCallId`. */
async function acceptRemote(callId: string): Promise<void> {
  try {
    const token = await currentAccessToken();
    if (!token) {
      setPendingAcceptCallId(callId);
      return;
    }
    const res = await fetch(`${API_BASE_URL}${Endpoints.calls.accept(callId)}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      setPendingAcceptCallId(callId);
      return;
    }
    const body = (await res.json()) as Omit<PendingAcceptResult, 'callId'>;
    setPendingAcceptResult({ callId, ...body });
  } catch {
    setPendingAcceptCallId(callId);
  }
}

export function registerBackgroundNotificationHandler(): void {
  notifee.onBackgroundEvent(async ({ type, detail }) => {
    const pressId = detail.pressAction?.id;
    const data = detail.notification?.data ?? {};
    const callId = data.callId ? String(data.callId) : '';

    if (type === EventType.ACTION_PRESS && pressId === 'call-reject' && callId) {
      await rejectRemote(callId);
      await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
      return;
    }

    if (type === EventType.ACTION_PRESS && pressId === 'call-accept') {
      // annule tout de suite la sonnerie visible (ongoing/autoCancel:false) —
      // sur un démarrage lent la notif resterait sinon visible plusieurs
      // secondes après le tap, donnant l'impression que rien ne s'est passé.
      await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
      // accepte IMMÉDIATEMENT côté serveur (voir acceptRemote) — n'attend
      // PAS le démarrage de l'app, qui peut prendre 10+ secondes sur un
      // cold start et laisser l'appelant raccrocher lui-même entre-temps.
      if (callId) await acceptRemote(callId);
      // `launchActivity: 'default'` ouvre l'app ; CallContext lit le résultat
      // déjà obtenu (ou refait l'appel si acceptRemote a échoué).
      return;
    }

    // Tap simple sur le CORPS de la notification (pas le bouton "Répondre") :
    // ramène juste l'app au premier plan (launchActivity s'en charge déjà),
    // SANS accepter l'appel à sa place — un simple coup d'œil ne doit pas
    // décrocher. `CallContext` affiche déjà l'écran d'appel entrant normal
    // (le WS a déjà posé `phase: 'incoming'`) dès que l'app est ramenée.
    if (type === EventType.PRESS && (pressId === 'incoming-call' || data.kind === 'call')) {
      return;
    }

    if (type === EventType.DISMISSED) {
      await notifee.cancelNotification(INCOMING_CALL_NOTIF_ID);
    }
  });
}
