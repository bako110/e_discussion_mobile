/**
 * @format
 *
 * `./src/bootstrap` DOIT rester la toute première ligne : il initialise les
 * modules natifs (polyfills crypto, gesture-handler, LiveKit/WebRTC, handlers
 * de notifications) dans le bon ordre, avant que `./App` — et toute sa chaîne
 * d'imports — ne soit évalué. Voir src/bootstrap.js pour le pourquoi.
 */
import './src/bootstrap';

import { AppRegistry } from 'react-native';

import App from './App';
import { name as appName } from './app.json';

AppRegistry.registerComponent(appName, () => App);
