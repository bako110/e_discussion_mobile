/**
 * Schéma SQLite local (offline-first). Migrations appliquées au démarrage
 * par `initDb()` (une entrée du tableau = une version).
 *
 * Principe : l'app lit/écrit TOUJOURS le local d'abord. Les mutations
 * (envoi, réaction, lecture, accept…) sont journalisées dans `outbox` et
 * rejouées vers le serveur dès que le réseau revient. Chaque ligne locale
 * porte un `sync_state` :
 *   synced   — identique au serveur
 *   pending  — modifié localement, pas encore confirmé
 *   failed   — l'envoi a échoué définitivement (à re-tenter manuellement)
 */

export const SCHEMA_VERSION = 9;

export const MIGRATIONS: string[] = [
  // ── v1 ────────────────────────────────────────────────────────────────
  `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS conversations (
    id                     TEXT PRIMARY KEY,
    partner_id             TEXT NOT NULL,
    partner_json           TEXT NOT NULL,
    last_message           TEXT,
    last_message_type      TEXT,
    last_message_at        TEXT,
    last_message_encrypted INTEGER NOT NULL DEFAULT 0,
    unread_count           INTEGER NOT NULL DEFAULT 0,
    muted                  INTEGER NOT NULL DEFAULT 0,
    request_status         TEXT NOT NULL DEFAULT 'accepted',
    sync_state             TEXT NOT NULL DEFAULT 'synced',
    updated_at             TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_conv_last ON conversations(last_message_at DESC);

  CREATE TABLE IF NOT EXISTS messages (
    id                TEXT PRIMARY KEY,
    client_id         TEXT UNIQUE,
    conversation_id   TEXT NOT NULL,
    sender_id         TEXT NOT NULL,
    type              TEXT NOT NULL DEFAULT 'text',
    body              TEXT NOT NULL DEFAULT '',
    body_cipher       TEXT,
    encrypted         INTEGER NOT NULL DEFAULT 0,
    attachment_url    TEXT,
    attachment_meta   TEXT,
    reply_to_json     TEXT,
    reaction          TEXT,
    delivered         INTEGER NOT NULL DEFAULT 0,
    read              INTEGER NOT NULL DEFAULT 0,
    -- vocal / vidéo REÇU : 1 quand JE l'ai écouté / ouvert (point bleu
    -- « non lu » façon WhatsApp). Toujours 1 pour mes propres messages.
    voice_played      INTEGER NOT NULL DEFAULT 0,
    edited_at         TEXT,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL,
    sync_state        TEXT NOT NULL DEFAULT 'synced'
  );
  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_sync ON messages(sync_state);

  CREATE TABLE IF NOT EXISTS outbox (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    kind         TEXT NOT NULL,
    client_id    TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT,
    created_at   TEXT NOT NULL,
    next_try_at  TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_outbox_ready ON outbox(next_try_at);
  `,

  // ── v2 : retire la contrainte FK messages -> conversations ────────────
  // En offline-first on peut recevoir/ecrire un message dans une conversation
  // dont la ligne locale n'existe pas encore (jamais synchronisee). La FK
  // faisait alors echouer silencieusement l'INSERT -> "impossible d'envoyer".
  // SQLite n'a pas de DROP CONSTRAINT : on recree la table sans la FK.
  `
  PRAGMA foreign_keys = OFF;

  CREATE TABLE messages_new (
    id                TEXT PRIMARY KEY,
    client_id         TEXT UNIQUE,
    conversation_id   TEXT NOT NULL,
    sender_id         TEXT NOT NULL,
    type              TEXT NOT NULL DEFAULT 'text',
    body              TEXT NOT NULL DEFAULT '',
    body_cipher       TEXT,
    encrypted         INTEGER NOT NULL DEFAULT 0,
    attachment_url    TEXT,
    attachment_meta   TEXT,
    reply_to_json     TEXT,
    reaction          TEXT,
    delivered         INTEGER NOT NULL DEFAULT 0,
    read              INTEGER NOT NULL DEFAULT 0,
    edited_at         TEXT,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL,
    sync_state        TEXT NOT NULL DEFAULT 'synced'
  );

  INSERT INTO messages_new SELECT
    id, client_id, conversation_id, sender_id, type, body, body_cipher, encrypted,
    attachment_url, attachment_meta, reply_to_json, reaction, delivered, read,
    edited_at, deleted_at, created_at, sync_state
  FROM messages;

  DROP TABLE messages;

  ALTER TABLE messages_new RENAME TO messages;

  CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_msg_sync ON messages(sync_state);
  `,

  // ── v3 : flag decrypt_failed + purge des anciennes lignes "indechiffrables"
  // (bug corrige : NOS propres messages etaient marques indechiffrables).
  `
  ALTER TABLE messages ADD COLUMN decrypt_failed INTEGER NOT NULL DEFAULT 0;

  UPDATE messages
     SET decrypt_failed = 1, body = ''
   WHERE body = 'Message chiffré indéchiffrable'
      OR body = '🔒 Message chiffré indéchiffrable';
  `,

  // ── v4 : purge des lignes recues indechiffrables (ancien bug X3DH : le pair
  // ratait le 1er message d'init). Le prochain pull delta les re-telechargera
  // et le nouveau code (X3DH rejoint sur chaque message non confirme) les
  // dechiffrera. On efface aussi le curseur de sync pour forcer un re-pull.
  `
  DELETE FROM messages
   WHERE decrypt_failed = 1 AND (body = '' OR body IS NULL);

  DELETE FROM meta WHERE key = 'last_sync_at';
  `,

  // ── v5 : blob chiffré qui a fui dans `body` (regression du pipeline de
  // dechiffrement — visible apres une reconnexion : "messages tous chiffres").
  // On deplace ces blobs vers body_cipher pour que retryFailedDecryptions()
  // puisse les recuperer une fois la session Double Ratchet re-etablie.
  `
  UPDATE messages
     SET body_cipher = body,
         body = '',
         decrypt_failed = 1
   WHERE body LIKE '{%"ciphertext"%'
     AND (body LIKE '%"senderDeviceId"%' OR body LIKE '%"contentType"%');

  DELETE FROM meta WHERE key = 'last_sync_at';
  `,

  // ── v6 : groupes & chaînes offline-first (aligné sur le 1-to-1).
  // `groups` = mes groupes/chaînes (cache disque de la liste). `group_messages`
  // = historique local ; les messages en attente portent sync_state='pending'
  // et sont rejoués via l'outbox (`send_group_message` / `upload_group_message`).
  `
  CREATE TABLE IF NOT EXISTS groups (
    id                  TEXT PRIMARY KEY,
    kind                TEXT NOT NULL DEFAULT 'group',
    name                TEXT NOT NULL DEFAULT '',
    description         TEXT,
    avatar_url          TEXT,
    owner_id            TEXT NOT NULL DEFAULT '',
    invite_code         TEXT NOT NULL DEFAULT '',
    is_public           INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL DEFAULT '',
    last_message_at     TEXT,
    last_message_preview TEXT,
    member_count        INTEGER NOT NULL DEFAULT 0,
    unread_count        INTEGER NOT NULL DEFAULT 0,
    my_role             TEXT,
    can_post            INTEGER NOT NULL DEFAULT 0,
    muted               INTEGER NOT NULL DEFAULT 0,
    sync_state          TEXT NOT NULL DEFAULT 'synced',
    updated_at          TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_group_last ON groups(last_message_at DESC);

  CREATE TABLE IF NOT EXISTS group_messages (
    id                TEXT PRIMARY KEY,
    client_id         TEXT UNIQUE,
    group_id          TEXT NOT NULL,
    sender_id         TEXT NOT NULL,
    sender_json       TEXT,
    type              TEXT NOT NULL DEFAULT 'text',
    body              TEXT NOT NULL DEFAULT '',
    attachment_url    TEXT,
    attachment_meta   TEXT,
    edited_at         TEXT,
    deleted_at        TEXT,
    created_at        TEXT NOT NULL,
    sync_state        TEXT NOT NULL DEFAULT 'synced'
  );
  CREATE INDEX IF NOT EXISTS idx_gmsg_group ON group_messages(group_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_gmsg_sync ON group_messages(sync_state);
  `,

  // ── v7 : retire les emojis d'apercu (📷 🎬 🎤 📎 📍) des libelles de dernier
  // message deja stockes en local (conversations + groupes). Le nouveau code
  // ecrit deja des libelles sans emoji ; ceci nettoie l'existant.
  `
  UPDATE conversations SET last_message = TRIM(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(last_message,
      '📷 ', ''), '🎬 ', ''), '🎤 ', ''), '📎 ', ''), '📍 ', ''))
  WHERE last_message LIKE '📷 %' OR last_message LIKE '🎬 %'
     OR last_message LIKE '🎤 %' OR last_message LIKE '📎 %'
     OR last_message LIKE '📍 %';

  UPDATE groups SET last_message_preview = TRIM(
    REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(last_message_preview,
      '📷 ', ''), '🎬 ', ''), '🎤 ', ''), '📎 ', ''), '📍 ', ''))
  WHERE last_message_preview LIKE '📷 %' OR last_message_preview LIKE '🎬 %'
     OR last_message_preview LIKE '🎤 %' OR last_message_preview LIKE '📎 %'
     OR last_message_preview LIKE '📍 %';
  `,

  // ── v8 : `voice_played` — point bleu « vocal non écouté » chez le pair.
  // Les messages EXISTANTS sont marqués écoutés (1) pour ne pas afficher
  // rétroactivement des points bleus sur tout l'historique.
  `
  ALTER TABLE messages ADD COLUMN voice_played INTEGER NOT NULL DEFAULT 0;
  UPDATE messages SET voice_played = 1;
  `,

  // ── v9 : historique des notifications (messages reçus + appels). Alimenté
  // à chaque notif affichée ET pour les appels manqués même app au premier
  // plan, pour que l'écran « Notifications » soit complet et consultable
  // hors-ligne.
  `
  CREATE TABLE IF NOT EXISTS notifications (
    id               TEXT PRIMARY KEY,
    kind             TEXT NOT NULL,             -- 'message' | 'call'
    title            TEXT NOT NULL DEFAULT '',
    body             TEXT NOT NULL DEFAULT '',
    conversation_id  TEXT,
    group_id         TEXT,
    call_id          TEXT,
    peer_id          TEXT,
    avatar_url       TEXT,
    call_result      TEXT,                      -- 'missed' | 'incoming' | 'outgoing' | 'rejected'
    call_type        TEXT,                      -- 'voice' | 'video'
    read             INTEGER NOT NULL DEFAULT 0,
    created_at       TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_notif_unread ON notifications(read);
  `,
];
