/**
 * @format
 *
 * Ordre des imports IMPORTANT :
 *  1. react-native-get-random-values  -> polyfill `crypto.getRandomValues`
 *     requis par @noble/* (chiffrement E2E) et la generation d'UUID.
 *     DOIT etre charge avant tout code qui touche a crypto.
 *  2. polyfill TextEncoder/TextDecoder -> Hermes ne les fournit pas ; requis
 *     par le module crypto E2E (string <-> Uint8Array). Avant tout code E2E.
 *  3. react-native-gesture-handler    -> requis en premier par la lib.
 *  4. @livekit/react-native registerGlobals -> installe les globals WebRTC
 *     (RTCPeerConnection, navigator.mediaDevices, ...) requis par les appels.
 *     Avant tout code qui instancie une Room LiveKit.
 */
import 'react-native-get-random-values';
import './src/polyfills/textEncoding';
import 'react-native-gesture-handler';
import { registerGlobals as registerLiveKitGlobals } from '@livekit/react-native';
import { AppRegistry } from 'react-native';

import { registerBackgroundNotificationHandler } from './src/services/notificationBackground';

registerLiveKitGlobals();
// Handler de notifications quand l'app est en arrière-plan / fermée
// (boutons Répondre / Refuser de la sonnerie, balayage de la notif).
registerBackgroundNotificationHandler();

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
