import { Platform } from 'react-native';

/**
 * URL de l'API.
 *
 * Prod : le backend est déployé sur le VPS en SOUS-CHEMIN de gofolyx.com
 *   API + WebSocket + médias  ->  https://gofolyx.com/edisc
 *   SFU LiveKit (appels)      ->  wss://gofolyx.com/edisc-sfu
 *
 * Dev :
 *  - Appareil Android PHYSIQUE par USB : `adb reverse tcp:8000 tcp:8000`
 *    puis `localhost:8000` fonctionne. C'est le defaut ici.
 *  - Emulateur Android : `localhost` = l'emulateur lui-meme ; utiliser
 *    `10.0.2.2:8000` (mettre DEV_API_HOST ci-dessous a '10.0.2.2').
 *  - iOS (simulateur) : `localhost` fonctionne directement.
 *
 * Surcharges via variables Metro (sans toucher au code) :
 *  - `RN_API_HOST=192.168.1.20 npm start`  -> change l'hote dev
 *  - `RN_API_BASE=https://gofolyx.com/edisc npm start`  -> pointe le build
 *    dev directement sur la prod (utile pour tester sur un vrai reseau).
 */
const ENV = typeof process !== 'undefined' && process.env ? process.env : ({} as Record<string, string | undefined>);

/** Base publique de la prod. Le WebSocket et le SFU en derivent. */
export const PROD_API_BASE = 'https://gofolyx.com/edisc';
/** SFU LiveKit auto-heberge (appels). Repris par le backend via /calls/config. */
export const PROD_LIVEKIT_URL = 'wss://gofolyx.com/edisc-sfu';

const DEV_API_HOST = ENV.RN_API_HOST || 'localhost';
const DEV_PORT = 8000;
const DEV_API_BASE = Platform.select({
  android: `http://${DEV_API_HOST}:${DEV_PORT}`,
  ios: `http://${DEV_API_HOST}:${DEV_PORT}`,
  default: `http://${DEV_API_HOST}:${DEV_PORT}`,
})!;

export const API_BASE_URL =
  ENV.RN_API_BASE || (__DEV__ ? DEV_API_BASE : PROD_API_BASE);

export const WS_URL = `${API_BASE_URL.replace(/^http/, 'ws')}/api/v1/ws`;

export const APP_NAME = 'E-discussion';
