/**
 * Nettoyage complet du build natif Android.
 *
 *   npm run android:clean   ->  nettoie puis `react-native run-android`
 *
 * À utiliser quand on vient d'ajouter / mettre à jour un module natif et que
 * le build incrémental part en vrille (CMake/ninja, .so périmés, codegen).
 */
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = process.cwd();
const A = (p) => join(ROOT, 'android', p);

const TARGETS = [
  A('app/build'),
  A('build'),
  A('.gradle'),
  A('app/.cxx'),
  A('.cxx'),
  'C:/rnb/ediscussion-cxx', // staging CMake déporté (Windows MAX_PATH, cf app/build.gradle)
  A('app/src/main/jniLibs'), // regénéré par l'autolinking
  join(ROOT, 'node_modules/.cache'),
];

console.log('> Nettoyage du build natif Android…');
for (const t of TARGETS) {
  if (existsSync(t)) {
    try {
      rmSync(t, { recursive: true, force: true });
      console.log('  supprimé', t.replace(ROOT + '\\', '').replace(ROOT + '/', ''));
    } catch (e) {
      console.warn('  (ignoré)', t, '-', e.message);
    }
  }
}

// .cxx des modules natifs (react-native-reanimated, screens, gesture-handler…)
const mods = spawnSync('node', ['scripts/native-deps-guard.mjs', '--list'], {
  cwd: ROOT,
  encoding: 'utf8',
}).stdout || '';
for (const m of mods.split('\n').map((s) => s.trim()).filter(Boolean)) {
  for (const sub of ['.cxx', 'android/.cxx', 'android/build', 'android/.gradle']) {
    const p = join(ROOT, 'node_modules', m, sub);
    if (existsSync(p)) {
      try {
        rmSync(p, { recursive: true, force: true });
        console.log('  supprimé node_modules/' + m + '/' + sub);
      } catch {
        /* verrou Windows éventuel — ignoré */
      }
    }
  }
}

// arrête le daemon Gradle pour libérer les verrous de fichiers (Windows)
console.log('> Arrêt du daemon Gradle…');
spawnSync(process.platform === 'win32' ? 'android\\gradlew.bat' : './android/gradlew', ['--stop'], {
  cwd: ROOT,
  stdio: 'ignore',
});

console.log('> Nettoyage terminé. Lancement de react-native run-android…\n');
