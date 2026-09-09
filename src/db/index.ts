/**
 * Connexion SQLite locale + exécution des migrations. `getDb()` est
 * synchrone une fois `initDb()` résolu (appelé une fois au démarrage).
 */
import { type DB, open } from '@op-engineering/op-sqlite';

import { MIGRATIONS, SCHEMA_VERSION } from './schema';

let db: DB | null = null;

export async function initDb(): Promise<DB> {
  if (db) return db;
  db = open({ name: 'ediscussion.db' });

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
