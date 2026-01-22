import type { DatabaseSync } from "node:sqlite";

/**
 * Ensures the contact store schema is created in the SQLite database.
 * Creates tables for contacts, platform identities, and indexed messages.
 */
export function ensureContactStoreSchema(db: DatabaseSync): {
  ftsAvailable: boolean;
  ftsError?: string;
} {
  // Unified contacts table - canonical contact records
  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      canonical_id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // Platform identities table - links platform-specific IDs to canonical contacts
  db.exec(`
    CREATE TABLE IF NOT EXISTS platform_identities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      contact_id TEXT NOT NULL REFERENCES contacts(canonical_id) ON DELETE CASCADE,
      platform TEXT NOT NULL,
      platform_id TEXT NOT NULL,
      username TEXT,
      phone TEXT,
      display_name TEXT,
      last_seen_at INTEGER,
      UNIQUE(platform, platform_id)
    );
  `);

  // Indexed messages table - for cross-platform message search
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexed_messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      contact_id TEXT REFERENCES contacts(canonical_id) ON DELETE SET NULL,
      platform TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      channel_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      embedding TEXT
    );
  `);

  // Indexes for efficient queries
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_platform_identities_contact_id ON platform_identities(contact_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_platform_identities_platform ON platform_identities(platform);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_platform_identities_phone ON platform_identities(phone);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_platform_identities_username ON platform_identities(username);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_indexed_messages_contact_id ON indexed_messages(contact_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_indexed_messages_platform ON indexed_messages(platform);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_indexed_messages_sender_id ON indexed_messages(sender_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_indexed_messages_channel_id ON indexed_messages(channel_id);`,
  );
  db.exec(
    `CREATE INDEX IF NOT EXISTS idx_indexed_messages_timestamp ON indexed_messages(timestamp);`,
  );

  // Full-text search virtual table for message content
  let ftsAvailable = false;
  let ftsError: string | undefined;
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        content,
        id UNINDEXED,
        contact_id UNINDEXED,
        platform UNINDEXED,
        sender_id UNINDEXED,
        channel_id UNINDEXED,
        timestamp UNINDEXED
      );
    `);
    ftsAvailable = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ftsAvailable = false;
    ftsError = message;
  }

  // Migration helper - add columns if they don't exist
  ensureColumn(db, "contacts", "aliases", "TEXT NOT NULL DEFAULT '[]'");

  return { ftsAvailable, ...(ftsError ? { ftsError } : {}) };
}

/**
 * Ensures a column exists on a table, adding it if missing.
 */
function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (rows.some((row) => row.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

/**
 * Drop all contact store tables (for testing/reset).
 */
export function dropContactStoreTables(db: DatabaseSync): void {
  db.exec(`DROP TABLE IF EXISTS messages_fts;`);
  db.exec(`DROP TABLE IF EXISTS indexed_messages;`);
  db.exec(`DROP TABLE IF EXISTS platform_identities;`);
  db.exec(`DROP TABLE IF EXISTS contacts;`);
}
