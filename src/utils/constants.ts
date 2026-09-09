import { Platform } from 'react-native';

/**
 * URL de l'API.
 *
 * Le backend de référence est celui DÉPLOYÉ EN LIGNE, en sous-chemin de
 * gofolyx.com — utilisé aussi bien en dev qu'en prod :
 *   API + WebSocket + médias  ->  https://gofolyx.com/edisc
 *   SFU LiveKit (appels)      ->  wss://gofolyx.com/edisc-sfu
 *
 * Pour développer contre un backend LOCAL (rare), poser une variable Metro
 * au lancement :
 *   RN_API_HOST=localhost npm start        (device USB : `adb reverse tcp:8000 tcp:8000`)
 *   RN_API_HOST=10.0.2.2  npm start        (émulateur Android)
 *   RN_API_BASE=http://192.168.1.20:8000 npm start   (URL complète, priorité max)
 */
const ENV =
  typeof process !== 'undefined' && process.env
    ? process.env
    : ({} as Record<string, string | undefined>);

/** Base publique de la prod. Le WebSocket et le SFU en dérivent. */
export const PROD_API_BASE = 'https://gofolyx.com/edisc';
/** SFU LiveKit auto-hébergé (appels). Repris par le backend via /calls/config. */
export const PROD_LIVEKIT_URL = 'wss://gofolyx.com/edisc-sfu';

/** Override local optionnel (dev contre un backend sur sa machine). */
const LOCAL_OVERRIDE = ENV.RN_API_BASE
  ? ENV.RN_API_BASE
  : ENV.RN_API_HOST
    ? Platform.select({
        android: `http://${ENV.RN_API_HOST}:8000`,
        ios: `http://${ENV.RN_API_HOST}:8000`,
        default: `http://${ENV.RN_API_HOST}:8000`,
      })!
    : null;

/** Par défaut : le backend EN LIGNE, en dev comme en prod. */
export const API_BASE_URL = LOCAL_OVERRIDE ?? PROD_API_BASE;

export const WS_URL = `${API_BASE_URL.replace(/^http/, 'ws')}/api/v1/ws`;

export const APP_NAME = 'E-discussion';
