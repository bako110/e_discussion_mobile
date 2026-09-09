# E-discussion — Mobile (React Native)

Client de messagerie 1-to-1 chiffrée de bout en bout. Inspiré de `stream_mobile`,
projet autonome. Thème dérivé du logo E-discussion (bleu `#2F80ED` → vert `#27AE79`).

## Stack

| Couche | Choix |
|---|---|
| Runtime | React Native 0.79, React 19, Hermes |
| Navigation | `@react-navigation/native` + native-stack |
| État global | React Context (`AuthContext`, `ThemeContext`, `WebSocketContext`) — pas de Redux |
| Stockage | `react-native-mmkv` (préférences), `react-native-keychain` (tokens + clé MMKV chiffrée E2E) |
| E2EE | Signal Protocol (X3DH + Double Ratchet), primitives `@noble/*` — porté de `stream_mobile` |
| Temps réel | WebSocket natif vers `/api/v1/ws` |
| i18n | `i18next` + `react-i18next`, FR/EN, header `X-Lang` propagé à l'API |

## Arborescence

```
src/
  api/          client fetch (auth Bearer, refresh auto, retry) + endpoints
  crypto/       E2EE — primitives, x3dh, doubleRatchet, keyStore, sessionManager
  context/      AuthContext (session), ThemeContext, WebSocketContext
  services/     authService, conversationService, messageService, userService
  navigation/   RootNavigator → AuthNavigator | MainNavigator
  screens/
    Auth/       Welcome, SignIn, SignUp, VerifyCode (OTP)
    Main/       Conversations, Chat, NewConversation, Settings
  components/    common (Button, TextField, Avatar, BrandLogo, Screen), chat (MessageBubble)
  theme/        palette E-discussion (clair + sombre), espacements, typo
  i18n/         i18next + locales/{fr,en}.json
  utils/        storage (MMKV), constants, phone/identifier, time
```

## Flux couverts (v1)

- **Auth e-mail ET/OU téléphone** : inscription → OTP (e-mail ou SMS) → vérification → session ; connexion mot de passe ou par code.
- **Discussions** : liste avec non-lus / présence / aperçu, demandes de conversation (accepter / refuser), recherche d'utilisateurs, ouverture d'une conversation.
- **Chat** : messages texte **chiffrés E2E** (repli en clair si le destinataire n'a pas de clés), envoi optimiste, accusés (✓ / ✓✓), indicateur de saisie, réactions, suppression — le tout en temps réel via WebSocket.
- **Réglages** : thème (système / clair / sombre), langue (FR / EN), déconnexion.

## Démarrer

Prérequis : le [backend](../backend/README.md) doit tourner (`make up` → `:8000`).

```bash
cd frontend
npm install
# iOS uniquement :
cd ios && pod install && cd ..

npm start                 # Metro
npm run android           # ou : npm run ios
npm run tsc               # vérification TypeScript
```

En dev, l'API est jointe sur `http://10.0.2.2:8000` (émulateur Android) ou
`http://localhost:8000` (iOS) — voir `src/utils/constants.ts`.

## Notes E2EE

- Le backend ne stocke/relaie que des **clés publiques** et des **blobs chiffrés**.
- Les clés privées vivent dans un MMKV chiffré, dont la clé est protégée par le
  Keychain/Keystore matériel. Désinstaller l'app = perte définitive de
  l'historique chiffré (aucune sauvegarde serveur possible, par design).
- Phase 1 : un appareil actif par compte. Le multi-device (fan-out) est une
  étape suivante.

## Plateformes natives

Ce dépôt contient le code JS/TS. Les dossiers `android/` et `ios/` se génèrent
avec le template RN 0.79 (`npx @react-native-community/cli init` sur un dossier
temporaire, puis copie des dossiers `android/` et `ios/`), ou via une future
commande d'init dédiée.
