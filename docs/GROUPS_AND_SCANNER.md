# Groupes, Chaînes & Scanner QR

## Ce qui est câblé

### Backend (`/api/v1/groups`)
| Endpoint | Rôle |
|---|---|
| `GET /groups?kind=group\|channel` | mes groupes / chaînes (agrégats : `member_count`, `unread_count`, `my_role`, `can_post`, `last_message_preview`) |
| `POST /groups` | créer un groupe **ou** une chaîne (+ membres d'emblée) |
| `GET /groups/preview?code=<invite_code>` | aperçu avant adhésion (scan QR / lien) |
| `POST /groups/join` | rejoindre via `invite_code` (idempotent) |
| `GET /groups/{id}` · `PATCH /groups/{id}` | détail · édition (admin) |
| `GET /groups/{id}/members` | liste des membres + rôles |
| `POST /groups/{id}/leave` | quitter (transfert d'`owner` automatique, suppression si dernier) |
| `PUT /groups/{id}/mute` · `/unmute` | sourdine par membre |
| `GET/POST /groups/{id}/messages` | historique paginé (`before=<iso>`) · envoi (en clair) |
| `PUT /groups/{id}/read` | marque lu (met à jour `unread_count`) |

**Événements WebSocket** poussés à tous les membres : `group.added`, `group.message`,
`group.member` (`action: join|leave`), `group.updated`.

**Règles** : groupe = tout membre écrit ; chaîne = seuls `owner`/`admin` publient,
les autres sont `subscriber` (lecture seule). Messages **non chiffrés** (comme les
réponses de story) — le 1-to-1 garde son E2E.

Migration : `d3e4f5a6b7c8_groups.py` (tables `groups`, `group_members`,
`group_messages`). `alembic upgrade head`.

### Frontend
- `groupService` + `GroupsContext` (liste + non-lus, refresh sur `group.*`)
- Écrans : `CreateGroupScreen`, `GroupsListScreen`, `GroupChatScreen`,
  `GroupInfoScreen`, `ScannerScreen`, `JoinPreviewScreen`
- `StatusScreen` : cartes « Groupes / Chaînes » réelles (compteurs + badges non-lus),
  liste des groupes récents, QR du header → `Scanner`, « Nouveau » → `CreateGroup`
- Lien d'invitation : `gofolyx://join/<invite_code>` (encodé dans le QR, partagé
  via la feuille de partage native depuis `GroupInfoScreen`)

## Scanner QR — étape native requise

`ScannerScreen` **fonctionne déjà sans rien installer** : il bascule sur la saisie
manuelle du code d'invitation. Pour activer la caméra :

```bash
cd frontend
npm install                      # react-native-vision-camera est dans package.json
cd ios && pod install && cd ..   # iOS
npm run android  # ou: npx react-native run-ios   → REBUILD natif obligatoire
```

Permissions déjà ajoutées :
- Android : `android.permission.CAMERA` + `uses-feature camera` (`AndroidManifest.xml`)
- iOS : `NSCameraUsageDescription` (`Info.plist`)

Le chargement du module est paresseux (`eval('require')`) : aucune erreur de
bundling si le package n'est pas encore là.

## Médias (images / vidéos / audio / avatars)

### Backend
- `POST /api/v1/media/upload` (multipart, champ `file`) → écrit sous
  `<MEDIA_ROOT>/<yyyy>/<mm>/<uuid>.<ext>`, servi en statique sous `/media`.
- **Images** : re-encodées + redimensionnées (`IMAGE_MAX_DIM`, défaut 1600) +
  miniature `_thumb.jpg` (`THUMB_MAX_DIM`, défaut 320) via Pillow.
- **Vidéos** : stockées telles quelles + miniature (1re frame) via `ffmpeg` si
  présent — sinon pas de miniature, pas d'échec. Durée via `ffprobe`.
- **Audio** : stocké tel quel, durée via `ffprobe` si dispo.
- Réponse : `{ url, media_type, thumbnail_url, width, height, duration_sec, size }`.
- Config : `MEDIA_ROOT`, `MEDIA_URL_PREFIX`, `MEDIA_PUBLIC_BASE` (vide → URL
  relative), `MAX_UPLOAD_MB` (80), `FFMPEG_BIN`.
- `media/` est git-ignoré.

### Frontend
- `mediaService.upload(file)` + `apiClient.upload()` (multipart, refresh 401).
- `useMediaPicker()` : `pickImage/pickVideo` (galerie ou caméra),
  `startRecording/stopRecording` (note vocale) — **chargement paresseux** des
  libs natives ; sans elles, une alerte explique qu'il faut installer + rebuild.
- `utils/media.ts` → `mediaUrl()` préfixe les chemins `/media/...` renvoyés par
  l'API avec `API_BASE_URL`. Appliqué dans `Avatar` (couvre user/groupe/chaîne)
  et tous les `<Image>` de story/groupe.
- Écrans câblés :
  - **StoryComposer** : modes Photo / Vidéo / Audio réels (aperçu + légende).
  - **EditProfile** : avatar (galerie/caméra) enregistré immédiatement + nom /
    username / bio.
  - **CreateGroup** : avatar du groupe/chaîne à la création.
  - **GroupInfo** : avatar + description éditables par owner/admin.
  - **GroupChat** : bouton trombone → image/vidéo (bulle avec miniature,
    `MediaViewer` plein écran).
  - **MediaViewer** : image plein écran ; vidéo = miniature + ouverture lecteur
    système (`react-native-video` intégrable plus tard).

### Étape native requise pour les médias
```bash
cd frontend && npm install
cd ios && pod install && cd ..
npx react-native run-android   # ou run-ios  → REBUILD natif
```
Packages ajoutés : `react-native-image-picker`,
`react-native-audio-recorder-player`. Permissions déjà posées :
- Android : `CAMERA`, `RECORD_AUDIO`, `READ_EXTERNAL_STORAGE` (maxSdk 32)
- iOS : `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription`,
  `NSMicrophoneUsageDescription`

## Reste à faire (hors périmètre)
- Offline-first pour les messages de groupe
- Rôles avancés (promouvoir admin, retirer un membre)
- Lecteur vidéo intégré (`react-native-video`)
- Deep-linking OS réel de `gofolyx://join/<code>`
- Annuaire public des chaînes populaires (`is_public` déjà stocké)
- Stockage objet S3 (le service media est isolé, migration facile)
