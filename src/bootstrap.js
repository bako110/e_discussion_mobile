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

// 0. Filet global : capture toute exception JS fatale qui échappe à React
//    (listener AppState/NetInfo hors rendu, callback headless, timer...).
//    `AppErrorBoundary` ne voit QUE les erreurs levées pendant le rendu React
//    — sans ce handler, une exception ici tue le pont JS et se traduit, en
//    build release (pas de red-box), par « l'app a cessé de fonctionner »
//    sans aucune trace exploitable. PAS un import (les imports sont hoistés
//    avant tout statement de ce fichier, voir ci-dessus) — un vrai
//    statement exécuté en premier, avant que le moindre import puisse planter.
if (typeof ErrorUtils !== 'undefined') {
  const defaultHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.warn('[bootstrap] exception JS non gérée', { isFatal, error });
    defaultHandler(error, isFatal);
  });
}

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

// 6. Handler FCM en arrière-plan / app tuée — construit la notif à partir du
//    message data-only du backend (sonnerie d'appel, bulle de message).
//    DOIT être au scope module, sinon pas de réveil app tuée.
import { registerFcmBackgroundHandler } from './services/fcm';

registerFcmBackgroundHandler();

// 7. Base SQLite locale — DOIT être ouverte ICI (scope module), pas
//    seulement via le useEffect de SyncContext (qui ne tourne jamais dans
//    le process headless relancé par un push FCM app tuée). Sans ça,
//    `getDb()` throw pour tout accès depuis `fcm.ts` (ex: vérifier si une
//    conversation est en sourdine avant d'afficher une notif de message) —
//    l'erreur est bien catchée, mais la notif pouvait quand même ne jamais
//    s'afficher selon le point exact où le throw survient dans la chaîne.
//    Best-effort : ne doit jamais bloquer/planter le démarrage de l'app.
import { initDb } from './db';

void initDb().catch(() => undefined);
