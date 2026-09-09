import { Platform } from 'react-native';

/**
 * URL de l'API.
 *
 * Dev :
 *  - Appareil Android PHYSIQUE par USB : lancer `adb reverse tcp:8000 tcp:8000`
 *    puis `localhost:8000` fonctionne. C'est le defaut ici.
 *  - Emulateur Android : `localhost` = l'emulateur lui-meme ; utiliser plutot
 *    `10.0.2.2:8000` (mettre DEV_API_HOST ci-dessous a '10.0.2.2').
 *  - iOS (simulateur) : `localhost` fonctionne directement.
 *
 * Pour surcharger sans toucher le code : poser la variable Metro
 * `RN_API_HOST` (ex: `RN_API_HOST=192.168.1.20 npm start`).
 */
const ENV_HOST =
  typeof process !== 'undefined' && process.env ? process.env.RN_API_HOST : undefined;
const DEV_API_HOST = ENV_HOST || 'localhost';

const DEV_PORT = 8000;

export const API_BASE_URL = __DEV__
  ? Platform.select({
      android: `http://${DEV_API_HOST}:${DEV_PORT}`,
      ios: `http://${DEV_API_HOST}:${DEV_PORT}`,
      default: `http://${DEV_API_HOST}:${DEV_PORT}`,
    })!
  : 'https://api.ediscussion.app';

export const WS_URL = `${API_BASE_URL.replace(/^http/, 'ws')}/api/v1/ws`;

export const APP_NAME = 'E-discussion';
