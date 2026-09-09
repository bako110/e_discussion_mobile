/**
 * `npm run android` — ouvre Metro dans une fenetre a part, puis build + install + lance l'app.
 *
 *  1. Metro : reutilise si :8081 repond, sinon ouvre une nouvelle fenetre console.
 *  2. Choix de l'appareil :
 *       npm run android                 -> tous les appareils connectes
 *       npm run android -- <serial>     -> uniquement cet appareil
 *       npm run android -- first        -> le premier de `adb devices`
 *       ANDROID_SERIAL=<serial> ...     -> idem via variable d'env
 *  3. adb reverse (8081 Metro, 8000 backend) sur chaque appareil cible.
 *  4. Build APK debug via Gradle (une seule fois), puis install + lancement
 *     sur chaque appareil.
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import http from 'node:http';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const PORT = 8081;
const IS_WIN = process.platform === 'win32';
const CWD = process.cwd();
const ANDROID_DIR = join(CWD, 'android');
const APK = join(ANDROID_DIR, 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');
const MAIN_ACTIVITY = 'com.ediscussion/.MainActivity';

const run = (cmd, args, opts = {}) =>
  spawnSync(cmd, args, { stdio: 'inherit', cwd: CWD, ...opts }).status ?? 0;

function metroUp() {
  return new Promise((resolve) => {
    const req = http.get({ host: 'localhost', port: PORT, path: '/status', timeout: 1200 }, (res) => {
      let b = '';
      res.on('data', (d) => (b += d));
      res.on('end', () => resolve(b.includes('packager-status:running')));
    });
    req.on('error', () => resolve(false));
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
  });
}

function openMetroWindow() {
  if (IS_WIN) {
    spawn(
      process.env.ComSpec || 'cmd.exe',
      ['/c', 'start', '"Metro - E-discussion"', '/D', CWD, 'cmd', '/k', 'npm', 'start'],
      { cwd: CWD, detached: true, stdio: 'ignore', windowsVerbatimArguments: true },
    ).unref();
  } else if (process.platform === 'darwin') {
    spawn('osascript', ['-e', `tell app "Terminal" to do script "cd '${CWD}' && npm start"`], {
      detached: true,
      stdio: 'ignore',
    }).unref();
  } else {
    const term = process.env.TERMINAL || 'x-terminal-emulator';
    try {
      spawn(term, ['-e', `bash -lc "cd '${CWD}' && npm start"`], { detached: true, stdio: 'ignore' }).unref();
    } catch {
      spawn('npm', ['start'], { cwd: CWD, detached: true, stdio: 'ignore' }).unref();
    }
  }
}

async function ensureMetro() {
  if (await metroUp()) {
    console.log(`> Metro tourne deja sur :${PORT} — reutilise (fenetre existante).`);
    return;
  }
  console.log('> Ouverture de Metro dans une nouvelle fenetre…');
  openMetroWindow();
  process.stdout.write('> Attente de Metro');
  for (let i = 0; i < 90; i++) {
    await sleep(1000);
    process.stdout.write('.');
    if (await metroUp()) {
      console.log(' pret.');
      return;
    }
  }
  console.log("\n! Metro ne repond pas. Ouvre un terminal et lance `npm start`, puis relance.");
  process.exit(1);
}

/** Tous les appareils "device" (hors entrees mDNS _adb-tls). */
function listDevices() {
  const out = spawnSync('adb', ['devices'], { encoding: 'utf8' }).stdout ?? '';
  return out
    .split('\n')
    .slice(1)
    .map((l) => l.match(/^(\S+)\s+device\b/))
    .filter((m) => m && !m[1].includes('_adb-tls'))
    .map((m) => m[1]);
}

function pickTargets(all) {
  // arg CLI apres `--`, sinon ANDROID_SERIAL, sinon tout
  const arg = process.argv[2];
  const wanted = arg && arg !== 'all' ? arg : process.env.ANDROID_SERIAL;

  if (!wanted || wanted === 'all') return all;
  if (wanted === 'first') return all.slice(0, 1);
  const match = all.filter((d) => d === wanted || d.startsWith(wanted));
  if (match.length === 0) {
    console.error(`! Appareil "${wanted}" introuvable. Connectes : ${all.join(', ') || '(aucun)'}`);
    process.exit(1);
  }
  return match;
}

async function main() {
  await ensureMetro();

  const all = listDevices();
  if (all.length === 0) {
    console.error('\n! Aucun appareil ADB. Branche un telephone (USB debug) ou lance un emulateur.');
    process.exit(1);
  }
  const targets = pickTargets(all);
  console.log(`> Appareils cibles : ${targets.join(', ')}`);

  for (const d of targets) {
    for (const map of [['tcp:8081', 'tcp:8081'], ['tcp:8000', 'tcp:8000']]) {
      spawnSync('adb', ['-s', d, 'reverse', ...map], { stdio: 'ignore' });
    }
  }

  const gradlew = IS_WIN ? join(ANDROID_DIR, 'gradlew.bat') : join(ANDROID_DIR, 'gradlew');
  console.log('> Build : gradlew assembleDebug');
  if (run(gradlew, ['assembleDebug', '--console=plain'], { cwd: ANDROID_DIR }) !== 0) process.exit(1);
  if (!existsSync(APK)) {
    console.error('! APK introuvable :', APK);
    process.exit(1);
  }

  let failed = 0;
  for (const d of targets) {
    console.log(`\n> [${d}] Installation…`);
    if (run('adb', ['-s', d, 'install', '-r', APK]) !== 0) {
      console.error(`  echec de l'installation sur ${d}`);
      failed++;
      continue;
    }
    run('adb', ['-s', d, 'shell', 'am', 'start', '-n', MAIN_ACTIVITY]);
    console.log(`  lance sur ${d}`);
  }

  console.log('\nOK. Fenetre "Metro" ouverte a part — laisse-la, tape `r` dedans pour recharger.');
  if (failed) process.exit(1);
}

main();
