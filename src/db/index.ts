/**
 * Connexion SQLite locale + exécution des migrations. `getDb()` est
 * synchrone une fois `initDb()` résolu.
 */
import { ANDROID_DATABASE_PATH, type DB, open } from '@op-engineering/op-sqlite';
import { Platform } from 'react-native';
import ReactNativeBlobUtil from 'react-native-blob-util';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';
import { storage } from '@/utils/storage';

let db: DB | null = null;

const DB_NAME = 'ediscussion.db';

/**
 * Migration ponctuelle : un système multi-compte (supprimé depuis) stockait
 * la base de chaque compte non-legacy dans un fichier séparé
 * `ediscussion-{accountId}.db`. Un appareil ayant utilisé ce système garde
 * ce fichier sur disque — orphelin depuis que le code n'ouvre plus qu'un
 * fichier fixe `ediscussion.db` — avec TOUT l'historique de messages de
 * l'utilisateur dedans (jamais rejoué depuis le serveur, E2E local-only).
 * Sans cette migration, ces utilisateurs perdaient l'accès à tous leurs
 * messages : la liste de conversations réapparaît (resynchronisée depuis le
 * serveur dans le nouveau fichier vide), mais chaque conversation ouverte
 * reste vide.
 *
 * Stratégie : au premier démarrage suivant la mise à jour, si `ediscussion.db`
 * n'existe pas encore sur ce chemin, on cherche un fichier orphelin
 * `ediscussion-*.db` dans le même dossier et on le RENOMME vers le nom fixe
 * avant l'ouverture — aucune copie, aucune perte, idempotent (ne fait plus
 * rien une fois `ediscussion.db` créé). `active_account_id` (laissé en MMKV
 * par l'ancien système, jamais nettoyé) sert à désambiguïser s'il y a
 * plusieurs candidats orphelins sur le même appareil.
 */
async function migrateOrphanAccountDb(): Promise<void> {
  if (Platform.OS !== 'android') return; // iOS n'a jamais eu ce multi-compte en prod
  const dir = ANDROID_DATABASE_PATH as string;
  const target = `${dir}/${DB_NAME}`;
  try {
    if (await ReactNativeBlobUtil.fs.exists(target)) return; // déjà migré / compte neuf

    const entries = await ReactNativeBlobUtil.fs.ls(dir);
    const candidates = entries.filter((f) => /^ediscussion-[0-9a-fA-F-]{36}\.db$/.test(f));
    if (candidates.length === 0) return;

    let chosen = candidates[0]!;
    if (candidates.length > 1) {
      const activeId = storage.getString('active_account_id');
      const match = activeId && candidates.find((f) => f.includes(activeId));
      if (match) chosen = match;
      // sinon : plusieurs candidats, aucun ne correspond au compte actif —
      // on prend le premier plutôt que de laisser l'utilisateur sans aucune
      // donnée ; un cas à un seul candidat (de très loin le plus fréquent)
      // n'a de toute façon pas cette ambiguïté.
    }

    for (const suffix of ['', '-wal', '-shm']) {
      const src = `${dir}/${chosen}${suffix}`;
      const dst = `${target}${suffix}`;
      if (await ReactNativeBlobUtil.fs.exists(src)) {
        await ReactNativeBlobUtil.fs.mv(src, dst);
      }
    }
    console.warn(`[db] fichier orphelin migré: ${chosen} -> ${DB_NAME}`);
  } catch (e) {
    // best-effort : une DB vide vaut mieux qu'un crash au démarrage. Un
    // utilisateur concerné qui tombe ici garde son ancien fichier intact
    // sur disque (rien n'est supprimé), donc rien d'irréversible.
    console.warn('[db] migration fichier orphelin ignorée:', e);
  }
}

export async function initDb(): Promise<DB> {
  if (db) return db;
  await migrateOrphanAccountDb();
  db = open({ name: DB_NAME });

  await db.execute('PRAGMA journal_mode = WAL;');
  // Pas de FK cross-tables en local : offline-first, on peut ecrire un
  // message avant que sa conversation soit synchronisee.
  await db.execute('PRAGMA foreign_keys = OFF;');

  const res = await db.execute('PRAGMA user_version;');
  const current = Number((res.rows?.[0] as { user_version?: number } | undefined)?.user_version ?? 0);

  // ── Reconciliation de schema — AVANT les migrations, a CHAQUE demarrage ──
  // Rattrape le cas ou une ancienne migration a bumpe `user_version` sans
  // avoir reellement ajoute une colonne attendue (ex: `decrypt_failed` absent
  // alors que user_version >= 3). Ainsi une migration >= v4 qui reference
  // cette colonne fonctionne des CE demarrage. `ADD COLUMN` sur une colonne
  // existante leve -> on ignore. Ne s'applique que si la table existe deja.
  if (current > 0) {
    const expectedMessageCols: Array<[string, string]> = [
      ['body_cipher', 'TEXT'],
      ['client_id', 'TEXT'],
      ['decrypt_failed', 'INTEGER NOT NULL DEFAULT 0'],
      // ajoutee en v12 — un appareil ayant deja `user_version >= 12` d'une
      // build anterieure a cette colonne (schema v12 modifie apres coup) ne
      // rejoue jamais MIGRATIONS[11] : sans ce rattrapage, TOUT insert dans
      // `messages` echoue avec "no such column: forwarded_from_id" (cassait
      // meme l'envoi de messages normaux, pas seulement le transfert).
      ['forwarded_from_id', 'TEXT'],
      // ajoutee en v15 — meme rattrapage prealable, meme raison (colonne
      // referencee par les nouveaux INSERT/UPSERT de messageRepo).
      ['forwarded_from_name', 'TEXT'],
    ];
    try {
      const info = await db.execute('PRAGMA table_info(messages);');
      const have = new Set(
        (info.rows ?? []).map((r) => String((r as { name?: string }).name)),
      );
      if (have.size > 0) {
        for (const [col, decl] of expectedMessageCols) {
          if (!have.has(col)) {
            try {
              await db.execute(`ALTER TABLE messages ADD COLUMN ${col} ${decl};`);
              console.warn(`[db] colonne manquante rattrapee: messages.${col}`);
            } catch (e) {
              console.warn(`[db] impossible d'ajouter messages.${col}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[db] reconciliation schema ignoree:', e);
    }

    // Même rattrapage pour group_messages (mêmes colonnes ajoutées en v12/v15).
    try {
      const info = await db.execute('PRAGMA table_info(group_messages);');
      const have = new Set(
        (info.rows ?? []).map((r) => String((r as { name?: string }).name)),
      );
      if (have.size > 0) {
        for (const [col, decl] of [
          ['forwarded_from_id', 'TEXT'],
          ['forwarded_from_name', 'TEXT'],
          // ajoutee en v16 — meme rattrapage prealable, meme raison.
          ['forward_count', 'INTEGER NOT NULL DEFAULT 0'],
        ] as const) {
          if (!have.has(col)) {
            try {
              await db.execute(`ALTER TABLE group_messages ADD COLUMN ${col} ${decl};`);
              console.warn(`[db] colonne manquante rattrapee: group_messages.${col}`);
            } catch (e) {
              console.warn(`[db] impossible d'ajouter group_messages.${col}:`, e);
            }
          }
        }
      }
    } catch (e) {
      console.warn('[db] reconciliation schema group_messages ignoree:', e);
    }
  }

  for (let v = current; v < SCHEMA_VERSION; v++) {
    const sql = MIGRATIONS[v];
    if (!sql) continue;
    for (const stmt of sql.split(';')) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;
      try {
        await db.execute(trimmed);
      } catch (e) {
        // migration idempotente : certaines instructions peuvent deja avoir
        // ete appliquees (ex: index) — on log mais on ne bloque pas.
        console.warn('[db] migration statement failed (ignored):', trimmed.slice(0, 60), e);
      }
    }
    // Version avancee APRES chaque migration : une migration qui echoue
    // partiellement ne fait pas "sauter" les suivantes.
    await db.execute(`PRAGMA user_version = ${v + 1};`);
  }

  return db;
}

export function getDb(): DB {
  if (!db) throw new Error('DB non initialisée — appelez initDb() au démarrage');
  return db;
}

/** Helper : SELECT → tableau d'objets typés. */
export async function query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const res = await getDb().execute(sql, params as never[]);
  return (res.rows ?? []) as T[];
}

/** Helper : INSERT/UPDATE/DELETE. */
export async function run(sql: string, params: unknown[] = []): Promise<void> {
  await getDb().execute(sql, params as never[]);
}

/** Transaction courte tout-ou-rien. */
export async function tx(
  fn: (execute: (sql: string, params?: unknown[]) => Promise<void>) => Promise<void>,
): Promise<void> {
  await getDb().transaction(async (t) => {
    await fn(async (sql, params = []) => {
      await t.execute(sql, params as never[]);
    });
  });
}
