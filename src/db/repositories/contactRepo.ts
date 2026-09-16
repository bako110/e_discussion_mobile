/**
 * Contacts — LOCAL-FIRST (aligné sur `groupRepo`). L'écran « nouvelle
 * discussion » lit toujours SQLite d'abord (instantané, hors-ligne OK) ;
 * `userService.refreshContacts()` rafraîchit depuis le serveur best-effort.
 *
 * `is_online`/`last_seen_at` sont volatiles (calculées via Redis côté
 * serveur) — traitées en best-effort, jamais comme source de vérité figée
 * après une longue période hors-ligne.
 */
import { query, run } from '@/db';
import type { UserPublic } from '@/types';

interface ContactRow {
  id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  about: string | null;
  last_seen_at: string | null;
  is_online: number;
  updated_at: string;
}

function toUser(r: ContactRow): UserPublic {
  return {
    id: r.id,
    username: r.username,
    display_name: r.display_name,
    avatar_url: r.avatar_url,
    about: r.about,
    last_seen_at: r.last_seen_at,
    is_online: !!r.is_online,
  };
}

export const contactRepo = {
  async list(): Promise<UserPublic[]> {
    const rows = await query<ContactRow>(
      'SELECT * FROM contacts ORDER BY COALESCE(display_name, username) COLLATE NOCASE',
    );
    return rows.map(toUser);
  },

  async upsertFromServer(u: UserPublic): Promise<void> {
    await run(
      `INSERT INTO contacts
        (id, username, display_name, avatar_url, about, last_seen_at, is_online, updated_at)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         username=excluded.username, display_name=excluded.display_name,
         avatar_url=excluded.avatar_url, about=excluded.about,
         last_seen_at=excluded.last_seen_at, is_online=excluded.is_online,
         updated_at=excluded.updated_at`,
      [
        u.id,
        u.username,
        u.display_name,
        u.avatar_url,
        u.about,
        u.last_seen_at,
        u.is_online ? 1 : 0,
        new Date().toISOString(),
      ],
    );
  },

  async bulkReplace(list: UserPublic[]): Promise<void> {
    for (const u of list) await contactRepo.upsertFromServer(u);
    // purge les contacts que le serveur ne renvoie plus (bloqué, etc.)
    if (list.length) {
      const ids = list.map((u) => `'${u.id}'`).join(',');
      await run(`DELETE FROM contacts WHERE id NOT IN (${ids})`);
    }
  },
};
