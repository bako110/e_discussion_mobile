# Lancer E-discussion (mobile)

## Développement — une seule commande

```bash
cd frontend
npm run android
```

`npm run android` (script `scripts/run-android.mjs`) fait **tout** :

1. **démarre Metro** si besoin (fenêtre à part, réutilisé s'il tourne déjà) ;
2. `adb reverse` pour Metro (8081) et le backend (8000) ;
3. build l'APK debug (Gradle) ;
4. `adb install -r` + lance l'app.

> Laisse la **fenêtre Metro ouverte**. Pour recharger après un changement
> JS/TS : tape `r` dans le terminal Metro (ou secoue le téléphone → *Reload*).
> Rebuild natif (`npm run android`) uniquement si tu touches à `android/`,
> aux dépendances natives, aux icônes ou au manifest.

> `npm run build` **n'existe pas** en React Native — c'est `npm run android`
> (dev) ou `npm run android:release` (APK autonome).

### Variantes

| Commande | Effet |
|---|---|
| `npm run android` | Metro + build + install + lance (le défaut) |
| `npm start` | Metro seul |
| `npm run android:only` | `react-native run-android` brut (sans le wrapper) |
| `npm run apk:debug` | build l'APK debug seulement |
| `npm run apk:install` | `adb install -r` le dernier APK debug |
| `npm run android:release` | APK release autonome (JS embarqué, sans Metro) |

### Recharger sans rebuild
Après `npm run android` la première fois, si tu ne changes que du **JS/TS** :
laisse Metro tourner et secoue le téléphone → *Reload* (ou `r` `r` dans le
terminal Metro). Pas besoin de relancer `npm run android`.

Rebuild natif nécessaire seulement si tu changes : dépendances natives,
`android/`, icônes, permissions, `AndroidManifest.xml`.

## Appareil physique par USB (recommandé ici)

```bash
adb devices                              # vérifier que le téléphone est listé
adb -s <ID> reverse tcp:8081 tcp:8081    # Metro joignable depuis le tel
npm run android
```

Si plusieurs entrées ADB (USB + Wi-Fi) : `adb disconnect <ip:port>` pour ne
garder que l'USB, sinon le build vise la connexion Wi-Fi (transferts d'APK
peu fiables).

## APK debug en une commande

```bash
npm run apk:debug      # -> android/app/build/outputs/apk/debug/app-debug.apk
npm run apk:install    # adb install -r
```

L'APK debug ne cible que **arm64-v8a** (voir `android/gradle.properties`,
`reactNativeArchitectures`) pour rester léger (~60 Mo). Pour un émulateur x86,
ajouter `x86_64` à cette liste.

## APK release (autonome, sans Metro)

```bash
npm run android:release
# -> android/app/build/outputs/apk/release/app-release.apk (bundle JS embarqué)
```

## Icône / logo

`npm run icons` régénère l'icône de l'app + le splash depuis
`src/assets/logo_e_discussion.png` (via `scripts/gen-icons.mjs`).

## Backend

L'app dev pointe sur `http://10.0.2.2:8000` (émulateur) ou `http://localhost:8000`
(iOS) — voir `src/utils/constants.ts`. Sur un **appareil physique par USB**,
ajouter le reverse : `adb -s <ID> reverse tcp:8000 tcp:8000` et le backend
sera joignable en `http://localhost:8000`.
