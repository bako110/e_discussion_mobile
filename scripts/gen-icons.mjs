/**
 * Genere les icones a partir du vrai logo src/assets/logo_e_discussion.png
 * (le logo source a un fond BLANC non transparent).
 *
 * Produit :
 *  - src/assets/logo_mark.png    : bulles seules, fond blanc (splash, ecrans clairs)
 *  - src/assets/logo_badge.png   : bulles dans un disque blanc (header bleu)
 *  - android mipmap ic_launcher + ic_launcher_round (toutes densites)
 *  - android drawable splash_logo
 *
 * Usage : node scripts/gen-icons.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const RES = join(root, 'android/app/src/main/res');
const SRC = join(root, 'src/assets/logo_e_discussion.png');

// Source 1254x1254 ; on isole les bulles (sans le mot "E-discussion").
const MARK = { left: 260, top: 180, width: 740, height: 590 };

/** Disque SVG (masque circulaire). */
const circleMask = (size) =>
  Buffer.from(
    `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`,
  );

async function markOnWhite(size) {
  return sharp(SRC)
    .extract(MARK)
    .resize(size, size, { fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .png()
    .toBuffer();
}

async function main() {
  // 1. logo_mark : bulles sur fond blanc carre
  writeFileSync(join(root, 'src/assets/logo_mark.png'), await markOnWhite(880));
  console.log('  src/assets/logo_mark.png');

  // 2. logo_badge : bulles dans un disque blanc (pour poser sur le header bleu)
  const S = 256;
  const inner = await sharp(SRC)
    .extract(MARK)
    .resize(Math.round(S * 0.72), Math.round(S * 0.72), { fit: 'contain', background: '#FFFFFF' })
    .flatten({ background: '#FFFFFF' })
    .toBuffer();
  const off = Math.round((S - S * 0.72) / 2);
  const badge = await sharp({ create: { width: S, height: S, channels: 4, background: '#FFFFFF' } })
    .composite([
      { input: inner, top: off, left: off },
      { input: circleMask(S), blend: 'dest-in' },
    ])
    .png()
    .toBuffer();
  writeFileSync(join(root, 'src/assets/logo_badge.png'), badge);
  console.log('  src/assets/logo_badge.png');

  // 3. icones launcher : bulles sur tuile blanche
  const DENSITIES = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(DENSITIES)) {
    const isize = Math.round(s * 0.72);
    const pad = Math.round((s - isize) / 2);
    const fg = await sharp(SRC)
      .extract(MARK)
      .resize(isize, isize, { fit: 'contain', background: '#FFFFFF' })
      .flatten({ background: '#FFFFFF' })
      .toBuffer();
    const tile = await sharp({ create: { width: s, height: s, channels: 4, background: '#FFFFFF' } })
      .composite([{ input: fg, top: pad, left: pad }])
      .png()
      .toBuffer();
    const out = join(RES, 'mipmap-' + d + '/ic_launcher.png');
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, tile);
    writeFileSync(join(RES, 'mipmap-' + d + '/ic_launcher_round.png'), tile);
    console.log('  mipmap-' + d + '/ic_launcher  ' + s + 'px');
  }

  // 4. splash
  const sp = join(RES, 'drawable/splash_logo.png');
  mkdirSync(dirname(sp), { recursive: true });
  writeFileSync(sp, await markOnWhite(560));
  console.log('  drawable/splash_logo.png');

  console.log('OK');
}

main();
