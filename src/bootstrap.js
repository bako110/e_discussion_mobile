/**
 * Bootstrap des modules natifs — importé en TOUTE PREMIÈRE ligne de index.js,
 * comme un side-effect (`import './src/bootstrap'`).
 *
 * Pourquoi un fichier dédié ?
 *   En ES modules, TOUS les `import` d'un fichier sont hoistés et exécutés
 *   AVANT le moindre statement de ce fichier. Donc si on met
 *   `registerGlobals()` après `import App from './App'` dans index.js, App
 *   (et toute sa chaîne : contexts, livekit-client…) est déjà évalué quand
 *   registerGlobals tourne -> « AudioDeviceModule is not initialized ».
 *
 *   Ici, chaque `import` est un side-effect pur, exécuté dans l'ordre, et ce
 *   fichier est importé avant `./App`. Tout setup natif qui doit tourner
 *   « au démarrage de l'app » va ICI, dans le bon ordre.
 */

// 1. crypto.getRandomValues — requis par @noble/* (E2E) et la génération d'UUID.
import 'react-native-get-random-values';

// 2. TextEncoder / TextDecoder — Hermes ne les fournit pas ; requis par le
//    module crypto E2E (string <-> Uint8Array).
import './polyfills/textEncoding';

// 3. react-native-gesture-handler — doit être importé avant tout composant.
import 'react-native-gesture-handler';

// 4. LiveKit / WebRTC — installe RTCPeerConnection, navigator.mediaDevices,
//    et initialise l'AudioDeviceModule natif. DOIT tourner avant qu'un
//    quelconque module ne touche `livekit-client` (donc avant App).
import { registerGlobals as registerLiveKitGlobals } from '@livekit/react-native';

registerLiveKitGlobals();

// 5. Handlers de notifications en arrière-plan (sonnerie d'appel : boutons
//    Répondre / Refuser quand l'app est fermée). Enregistrement au scope
//    module, obligatoire pour survivre à l'app tuée.
import { registerBackgroundNotificationHandler } from './services/notificationBackground';

registerBackgroundNotificationHandler();
