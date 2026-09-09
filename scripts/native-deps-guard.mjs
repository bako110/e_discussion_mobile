/**
 * Garde-fou des dépendances natives.
 *
 * Lancé automatiquement en `postinstall` (donc après chaque `npm install` /
 * `npm ci` / `npm i <pkg>`).
 *
 * Rôle : détecter quand la liste des modules RN AVEC code natif change
 * (ajout, suppression, changement de version) et, dans ce cas, invalider les
 * caches de build natif Android — pour que le prochain `npm run android`
 * (= `react-native run-android`) reparte sur une base saine au lieu de
 * réutiliser des `.so` / objets CMake périmés.
 *
 * Sans ça : on ajoute un module natif, `run-android` fait un build
 * incrémental, l'autolinking ajoute le module mais un cache CMake corrompu
 * fait échouer le build (ninja mkdir…) ou pire, l'ancien binaire reste et on
 * a un « module is not initialized » à l'exécution.
 *
 * Options :
 *   node scripts/native-deps-guard.mjs           (mode normal, postinstall)
 *   node scripts/native-deps-guard.mjs --list    (imprime les modules natifs)
 *   node scripts/native-deps-guard.mjs --force   (invalide sans comparer)
 */
import {
  readdirSync,
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const NM = join(ROOT, 'node_modules');
const SNAPSHOT = join(ROOT, 'android', '.native-deps.json');

/** Un package est « natif » s'il embarque un dossier android/ ou ios/ avec du build. */
function isNativeModule(pkgDir) {
  const android = join(pkgDir, 'android');
  const ios = join(pkgDir, 'ios');
  const hasAndroid =
    existsSync(join(android, 'build.gradle')) || existsSync(join(android, 'src'));
  const hasIos =
    existsSync(ios) &&
    (() => {
      try {
        return readdirSync(ios).some((f) => f.endsWith('.podspec'));
      } catch {
        return false;
      }
    })();
  // certains modules mettent le podspec à la racine
  const rootPodspec = (() => {
    try {
      return readdirSync(pkgDir).some((f) => f.endsWith('.podspec'));
    } catch {
      return false;
    }
  })();
  return hasAndroid || hasIos || rootPodspec;
}

function version(pkgDir) {
  try {
    return JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version ?? '?';
  } catch {
    return '?';
  }
}

/** Parcourt node_modules (+ scope @xxx) et retourne { "nom": "version" } des modules natifs. */
function scanNativeModules() {
  const out = {};
  if (!existsSync(NM)) return out;
  for (const entry of readdirSync(NM)) {
    if (entry.startsWith('.')) continue;
    const full = join(NM, entry);
    if (!safeIsDir(full)) continue;
    if (entry.startsWith('@')) {
      for (const sub of readdirSync(full)) {
        const p = join(full, sub);
        if (safeIsDir(p) && isNativeModule(p)) out[`${entry}/${sub}`] = version(p);
      }
    } else if (isNativeModule(full)) {
      out[entry] = version(full);
    }
  }
  return out;
}

function safeIsDir(p) {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function invalidateNativeCaches(reason) {
  const targets = [
    join(ROOT, 'android', 'app', 'build'),
    join(ROOT, 'android', 'app', '.cxx'),
    join(ROOT, 'android', '.cxx'),
    join(ROOT, 'android', 'build'),
    'C:/rnb/ediscussion-cxx', // staging CMake déporté sur Windows (app/build.gradle)
  ];
  let n = 0;
  for (const t of targets) {
    if (existsSync(t)) {
      try {
        rmSync(t, { recursive: true, force: true });
        n++;
      } catch {
        /* verrou éventuel — le build gérera */
      }
    }
  }
  console.log(
    `[native-deps-guard] ${reason} -> caches de build natif invalidés (${n}). ` +
      `Le prochain "npm run android" fera un build natif propre.`,
  );
}

// ── main ────────────────────────────────────────────────────────────────────
const arg = process.argv[2];
const current = scanNativeModules();

if (arg === '--list') {
  console.log(Object.keys(current).join('\n'));
  process.exit(0);
}

if (arg === '--force') {
  invalidateNativeCaches('forçage manuel');
  writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + '\n');
  process.exit(0);
}

let previous = {};
if (existsSync(SNAPSHOT)) {
  try {
    previous = JSON.parse(readFileSync(SNAPSHOT, 'utf8'));
  } catch {
    previous = {};
  }
}

const added = Object.keys(current).filter((k) => !(k in previous));
const removed = Object.keys(previous).filter((k) => !(k in current));
const changed = Object.keys(current).filter(
  (k) => k in previous && previous[k] !== current[k],
);

if (added.length || removed.length || changed.length) {
  const parts = [];
  if (added.length) parts.push(`ajout: ${added.join(', ')}`);
  if (removed.length) parts.push(`retrait: ${removed.join(', ')}`);
  if (changed.length)
    parts.push(
      `maj: ${changed.map((k) => `${k} ${previous[k]}→${current[k]}`).join(', ')}`,
    );
  invalidateNativeCaches(`modules natifs modifiés (${parts.join(' | ')})`);
} else {
  // rien de natif n'a bougé : build incrémental OK, on ne touche à rien.
}

writeFileSync(SNAPSHOT, JSON.stringify(current, null, 2) + '\n');
