import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync, StatementSync } from "node:sqlite";

import { requireNodeSqlite } from "../memory/sqlite.js";
import { resolveStateDir } from "../config/paths.js";
import { ensureContactStoreSchema } from "./schema.js";
import type {
  Contact,
  ContactSearchOptions,
  ContactWithIdentities,
  IndexedMessage,
  MessageSearchOptions,
  MessageSearchResult,
  Platform,
  PlatformIdentity,
  PlatformIdentityInput,
} from "./types.js";

const CONTACTS_DB_FILENAME = "contacts.sqlite";

/**
 * ContactStore manages the unified contact graph and message index.
 *
 * Key capabilities:
 * - Store and retrieve canonical contacts
 * - Link platform-specific identities to canonical contacts
 * - Index messages for cross-platform search
 * - Resolve sender identities to canonical contacts
 */
export class ContactStore {
  private db: DatabaseSync;
  private ftsAvailable: boolean;

  // Prepared statements for performance
  private stmtInsertContact: StatementSync;
  private stmtUpdateContact: StatementSync;
  private stmtGetContact: StatementSync;
  private stmtDeleteContact: StatementSync;
  private stmtInsertIdentity: StatementSync;
  private stmtGetIdentitiesByContact: StatementSync;
  private stmtGetIdentityByPlatformId: StatementSync;
  private stmtUpdateIdentityLastSeen: StatementSync;
  private stmtInsertMessage: StatementSync;
  private stmtInsertMessageFts: StatementSync | null;

  private constructor(db: DatabaseSync, ftsAvailable: boolean) {
    this.db = db;
    this.ftsAvailable = ftsAvailable;

    // Prepare statements
    this.stmtInsertContact = db.prepare(`
      INSERT INTO contacts (canonical_id, display_name, aliases, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.stmtUpdateContact = db.prepare(`
      UPDATE contacts SET display_name = ?, aliases = ?, updated_at = ? WHERE canonical_id = ?
    `);
    this.stmtGetContact = db.prepare(`
      SELECT canonical_id, display_name, aliases, created_at, updated_at
      FROM contacts WHERE canonical_id = ?
    `);
    this.stmtDeleteContact = db.prepare(`DELETE FROM contacts WHERE canonical_id = ?`);

    this.stmtInsertIdentity = db.prepare(`
      INSERT OR REPLACE INTO platform_identities
        (contact_id, platform, platform_id, username, phone, display_name, last_seen_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetIdentitiesByContact = db.prepare(`
      SELECT id, contact_id, platform, platform_id, username, phone, display_name, last_seen_at
      FROM platform_identities WHERE contact_id = ?
    `);
    this.stmtGetIdentityByPlatformId = db.prepare(`
      SELECT id, contact_id, platform, platform_id, username, phone, display_name, last_seen_at
      FROM platform_identities WHERE platform = ? AND platform_id = ?
    `);
    this.stmtUpdateIdentityLastSeen = db.prepare(`
      UPDATE platform_identities SET last_seen_at = ? WHERE platform = ? AND platform_id = ?
    `);

    this.stmtInsertMessage = db.prepare(`
      INSERT OR REPLACE INTO indexed_messages
        (id, content, contact_id, platform, sender_id, channel_id, timestamp, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    this.stmtInsertMessageFts = ftsAvailable
      ? db.prepare(`
          INSERT OR REPLACE INTO messages_fts
            (content, id, contact_id, platform, sender_id, channel_id, timestamp)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `)
      : null;
  }

  /**
   * Open or create a contact store database.
   */
  static open(dbPath?: string): ContactStore {
    const nodeSqlite = requireNodeSqlite();
    const resolvedPath = dbPath ?? path.join(resolveStateDir(), "contacts", CONTACTS_DB_FILENAME);

    // Ensure directory exists
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const db = new nodeSqlite.DatabaseSync(resolvedPath);

    // Enable foreign keys
    db.exec("PRAGMA foreign_keys = ON;");

    // Set up schema
    const { ftsAvailable } = ensureContactStoreSchema(db);

    return new ContactStore(db, ftsAvailable);
  }

  /**
   * Create a new in-memory store (for testing).
   */
  static openInMemory(): ContactStore {
    const nodeSqlite = requireNodeSqlite();
    const db = new nodeSqlite.DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    const { ftsAvailable } = ensureContactStoreSchema(db);
    return new ContactStore(db, ftsAvailable);
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // CONTACT OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Generate a canonical ID from a display name.
   */
  private generateCanonicalId(displayName: string): string {
    const slug = displayName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30);
    const suffix = randomUUID().slice(0, 8);
    return `${slug || "contact"}-${suffix}`;
  }

  /**
   * Create a new canonical contact.
   */
  createContact(displayName: string, aliases: string[] = []): Contact {
    const now = Date.now();
    const canonicalId = this.generateCanonicalId(displayName);
    this.stmtInsertContact.run(canonicalId, displayName, JSON.stringify(aliases), now, now);
    return {
      canonicalId,
      displayName,
      aliases,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a contact by canonical ID.
   */
  getContact(canonicalId: string): Contact | null {
    const row = this.stmtGetContact.get(canonicalId) as
      | {
          canonical_id: string;
          display_name: string;
          aliases: string;
          created_at: number;
          updated_at: number;
        }
      | undefined;
    if (!row) return null;
    return {
      canonicalId: row.canonical_id,
      displayName: row.display_name,
      aliases: JSON.parse(row.aliases) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Update a contact's display name and/or aliases.
   */
  updateContact(
    canonicalId: string,
    updates: { displayName?: string; aliases?: string[] },
  ): boolean {
    const existing = this.getContact(canonicalId);
    if (!existing) return false;

    const displayName = updates.displayName ?? existing.displayName;
    const aliases = updates.aliases ?? existing.aliases;
    const now = Date.now();

    this.stmtUpdateContact.run(displayName, JSON.stringify(aliases), now, canonicalId);
    return true;
  }

  /**
   * Delete a contact and all its platform identities.
   */
  deleteContact(canonicalId: string): boolean {
    const result = this.stmtDeleteContact.run(canonicalId);
    return result.changes > 0;
  }

  /**
   * List all contacts with optional filtering.
   */
  listContacts(options: ContactSearchOptions = {}): Contact[] {
    let sql = `SELECT canonical_id, display_name, aliases, created_at, updated_at FROM contacts`;
    const params: (string | number)[] = [];
    const conditions: string[] = [];

    if (options.query) {
      conditions.push(`(display_name LIKE ? OR aliases LIKE ?)`);
      const pattern = `%${options.query}%`;
      params.push(pattern, pattern);
    }

    if (options.platform) {
      conditions.push(
        `canonical_id IN (SELECT contact_id FROM platform_identities WHERE platform = ?)`,
      );
      params.push(options.platform);
    }

    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(" AND ")}`;
    }

    sql += ` ORDER BY updated_at DESC`;

    if (options.limit) {
      sql += ` LIMIT ?`;
      params.push(options.limit);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...params) as Array<{
      canonical_id: string;
      display_name: string;
      aliases: string;
      created_at: number;
      updated_at: number;
    }>;

    return rows.map((row) => ({
      canonicalId: row.canonical_id,
      displayName: row.display_name,
      aliases: JSON.parse(row.aliases) as string[],
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /**
   * Get a contact with all its platform identities.
   */
  getContactWithIdentities(canonicalId: string): ContactWithIdentities | null {
    const contact = this.getContact(canonicalId);
    if (!contact) return null;

    const identities = this.getIdentitiesByContact(canonicalId);
    return { ...contact, identities };
  }

  /**
   * Search contacts by name, alias, or username.
   */
  searchContacts(query: string, limit = 10): ContactWithIdentities[] {
    const pattern = `%${query}%`;

    // Search in contacts table
    const contactRows = this.db
      .prepare(
        `
        SELECT DISTINCT c.canonical_id
        FROM contacts c
        LEFT JOIN platform_identities pi ON c.canonical_id = pi.contact_id
        WHERE c.display_name LIKE ?
           OR c.aliases LIKE ?
           OR pi.username LIKE ?
           OR pi.display_name LIKE ?
        ORDER BY c.updated_at DESC
        LIMIT ?
      `,
      )
      .all(pattern, pattern, pattern, pattern, limit) as Array<{ canonical_id: string }>;

    return contactRows
      .map((row) => this.getContactWithIdentities(row.canonical_id))
      .filter((c): c is ContactWithIdentities => c !== null);
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // PLATFORM IDENTITY OPERATIONS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Add a platform identity to a contact.
   */
  addIdentity(input: PlatformIdentityInput): PlatformIdentity {
    this.stmtInsertIdentity.run(
      input.contactId,
      input.platform,
      input.platformId,
      input.username,
      input.phone,
      input.displayName,
      input.lastSeenAt,
    );

    // Get the inserted row to return
    const identity = this.getIdentityByPlatformId(input.platform, input.platformId);
    if (!identity) {
      throw new Error(
        `Failed to retrieve inserted identity: ${input.platform}:${input.platformId}`,
      );
    }
    return identity;
  }

  /**
   * Get all platform identities for a contact.
   */
  getIdentitiesByContact(contactId: string): PlatformIdentity[] {
    const rows = this.stmtGetIdentitiesByContact.all(contactId) as Array<{
      id: number;
      contact_id: string;
      platform: string;
      platform_id: string;
      username: string | null;
      phone: string | null;
      display_name: string | null;
      last_seen_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      platform: row.platform as Platform,
      platformId: row.platform_id,
      username: row.username,
      phone: row.phone,
      displayName: row.display_name,
      lastSeenAt: row.last_seen_at,
    }));
  }

  /**
   * Get a platform identity by platform and platform-specific ID.
   */
  getIdentityByPlatformId(
    platform: Platform | string,
    platformId: string,
  ): PlatformIdentity | null {
    const row = this.stmtGetIdentityByPlatformId.get(platform, platformId) as
      | {
          id: number;
          contact_id: string;
          platform: string;
          platform_id: string;
          username: string | null;
          phone: string | null;
          display_name: string | null;
          last_seen_at: number | null;
        }
      | undefined;

    if (!row) return null;
    return {
      id: row.id,
      contactId: row.contact_id,
      platform: row.platform as Platform,
      platformId: row.platform_id,
      username: row.username,
      phone: row.phone,
      displayName: row.display_name,
      lastSeenAt: row.last_seen_at,
    };
  }

  /**
   * Find identities by phone number across all platforms.
   */
  findIdentitiesByPhone(phone: string): PlatformIdentity[] {
    const normalized = this.normalizePhone(phone);
    const rows = this.db
      .prepare(
        `
        SELECT id, contact_id, platform, platform_id, username, phone, display_name, last_seen_at
        FROM platform_identities WHERE phone = ?
      `,
      )
      .all(normalized) as Array<{
      id: number;
      contact_id: string;
      platform: string;
      platform_id: string;
      username: string | null;
      phone: string | null;
      display_name: string | null;
      last_seen_at: number | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      contactId: row.contact_id,
      platform: row.platform as Platform,
      platformId: row.platform_id,
      username: row.username,
      phone: row.phone,
      displayName: row.display_name,
      lastSeenAt: row.last_seen_at,
    }));
  }

  /**
   * Update last seen timestamp for a platform identity.
   */
  updateIdentityLastSeen(platform: Platform | string, platformId: string): void {
    this.stmtUpdateIdentityLastSeen.run(Date.now(), platform, platformId);
  }

  /**
   * Resolve a platform sender to a canonical contact ID.
   * Returns null if the sender is not in the contact graph.
   */
  resolveContact(platform: Platform | string, platformId: string): string | null {
    const identity = this.getIdentityByPlatformId(platform, platformId);
    return identity?.contactId ?? null;
  }

  /**
   * Normalize a phone number to E.164 format.
   */
  private normalizePhone(phone: string): string {
    // Strip everything except digits and leading +
    let normalized = phone.replace(/[^+\d]/g, "");
    // Ensure it starts with +
    if (!normalized.startsWith("+") && normalized.length >= 10) {
      // Assume US if no country code and 10 digits
      if (normalized.length === 10) {
        normalized = `+1${normalized}`;
      } else {
        normalized = `+${normalized}`;
      }
    }
    return normalized;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // MESSAGE INDEXING
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Index a message for cross-platform search.
   */
  indexMessage(message: Omit<IndexedMessage, "embedding"> & { embedding?: string | null }): void {
    // Try to resolve the sender to a canonical contact
    const contactId = this.resolveContact(message.platform, message.senderId);

    this.stmtInsertMessage.run(
      message.id,
      message.content,
      contactId,
      message.platform,
      message.senderId,
      message.channelId,
      message.timestamp,
      message.embedding ?? null,
    );

    // Also insert into FTS table
    if (this.stmtInsertMessageFts && message.content) {
      this.stmtInsertMessageFts.run(
        message.content,
        message.id,
        contactId,
        message.platform,
        message.senderId,
        message.channelId,
        message.timestamp,
      );
    }

    // Update last seen timestamp for the sender
    if (contactId) {
      this.updateIdentityLastSeen(message.platform, message.senderId);
    }
  }

  /**
   * Search indexed messages.
   */
  searchMessages(options: MessageSearchOptions): MessageSearchResult[] {
    const results: MessageSearchResult[] = [];

    if (!options.query) return results;

    // Resolve "from" filter to contact IDs
    let contactIds: string[] | null = null;
    if (options.from) {
      // Try to find contact by canonical ID, name, or username
      const matches = this.searchContacts(options.from, 10);
      if (matches.length === 0) {
        // No matching contacts, return empty results
        return results;
      }
      contactIds = matches.map((m) => m.canonicalId);
    }

    // Build query based on FTS availability
    if (this.ftsAvailable) {
      return this.searchMessagesFts(options, contactIds);
    }
    return this.searchMessagesLike(options, contactIds);
  }

  private searchMessagesFts(
    options: MessageSearchOptions,
    contactIds: string[] | null,
  ): MessageSearchResult[] {
    let sql = `
      SELECT m.id, m.content, m.contact_id, m.platform, m.sender_id, m.channel_id, m.timestamp, m.embedding,
             bm25(messages_fts) as score
      FROM messages_fts fts
      JOIN indexed_messages m ON fts.id = m.id
      WHERE messages_fts MATCH ?
    `;
    const params: (string | number)[] = [options.query];

    if (contactIds && contactIds.length > 0) {
      const placeholders = contactIds.map(() => "?").join(",");
      sql += ` AND m.contact_id IN (${placeholders})`;
      params.push(...contactIds);
    }

    if (options.platforms && options.platforms.length > 0) {
      const placeholders = options.platforms.map(() => "?").join(",");
      sql += ` AND m.platform IN (${placeholders})`;
      params.push(...options.platforms);
    }

    if (options.channelId) {
      sql += ` AND m.channel_id = ?`;
      params.push(options.channelId);
    }

    if (options.since) {
      sql += ` AND m.timestamp >= ?`;
      params.push(options.since);
    }

    if (options.until) {
      sql += ` AND m.timestamp <= ?`;
      params.push(options.until);
    }

    sql += ` ORDER BY score LIMIT ?`;
    params.push(options.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      content: string;
      contact_id: string | null;
      platform: string;
      sender_id: string;
      channel_id: string;
      timestamp: number;
      embedding: string | null;
      score: number;
    }>;

    return rows.map((row) => {
      const contact = row.contact_id ? this.getContact(row.contact_id) : null;
      return {
        message: {
          id: row.id,
          content: row.content,
          contactId: row.contact_id,
          platform: row.platform as Platform,
          senderId: row.sender_id,
          channelId: row.channel_id,
          timestamp: row.timestamp,
          embedding: row.embedding,
        },
        contact,
        score: Math.abs(row.score), // BM25 returns negative scores
        snippet: this.createSnippet(row.content, options.query),
      };
    });
  }

  private searchMessagesLike(
    options: MessageSearchOptions,
    contactIds: string[] | null,
  ): MessageSearchResult[] {
    let sql = `
      SELECT id, content, contact_id, platform, sender_id, channel_id, timestamp, embedding
      FROM indexed_messages
      WHERE content LIKE ?
    `;
    const params: (string | number)[] = [`%${options.query}%`];

    if (contactIds && contactIds.length > 0) {
      const placeholders = contactIds.map(() => "?").join(",");
      sql += ` AND contact_id IN (${placeholders})`;
      params.push(...contactIds);
    }

    if (options.platforms && options.platforms.length > 0) {
      const placeholders = options.platforms.map(() => "?").join(",");
      sql += ` AND platform IN (${placeholders})`;
      params.push(...options.platforms);
    }

    if (options.channelId) {
      sql += ` AND channel_id = ?`;
      params.push(options.channelId);
    }

    if (options.since) {
      sql += ` AND timestamp >= ?`;
      params.push(options.since);
    }

    if (options.until) {
      sql += ` AND timestamp <= ?`;
      params.push(options.until);
    }

    sql += ` ORDER BY timestamp DESC LIMIT ?`;
    params.push(options.limit ?? 50);

    const rows = this.db.prepare(sql).all(...params) as Array<{
      id: string;
      content: string;
      contact_id: string | null;
      platform: string;
      sender_id: string;
      channel_id: string;
      timestamp: number;
      embedding: string | null;
    }>;

    return rows.map((row) => {
      const contact = row.contact_id ? this.getContact(row.contact_id) : null;
      return {
        message: {
          id: row.id,
          content: row.content,
          contactId: row.contact_id,
          platform: row.platform as Platform,
          senderId: row.sender_id,
          channelId: row.channel_id,
          timestamp: row.timestamp,
          embedding: row.embedding,
        },
        contact,
        score: 1.0, // Simple LIKE doesn't provide scoring
        snippet: this.createSnippet(row.content, options.query),
      };
    });
  }

  /**
   * Create a snippet with the query highlighted.
   */
  private createSnippet(content: string, query: string, maxLength = 200): string {
    const lowerContent = content.toLowerCase();
    const lowerQuery = query.toLowerCase();
    const index = lowerContent.indexOf(lowerQuery);

    if (index === -1) {
      return content.slice(0, maxLength) + (content.length > maxLength ? "..." : "");
    }

    // Center the snippet around the match
    const contextBefore = 50;
    const contextAfter = 100;
    let start = Math.max(0, index - contextBefore);
    let end = Math.min(content.length, index + query.length + contextAfter);

    // Adjust to word boundaries if possible
    if (start > 0) {
      const spaceIndex = content.lastIndexOf(" ", start + 10);
      if (spaceIndex > start - 20) start = spaceIndex + 1;
    }
    if (end < content.length) {
      const spaceIndex = content.indexOf(" ", end - 10);
      if (spaceIndex !== -1 && spaceIndex < end + 20) end = spaceIndex;
    }

    let snippet = content.slice(start, end);
    if (start > 0) snippet = "..." + snippet;
    if (end < content.length) snippet = snippet + "...";

    return snippet;
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // STATISTICS
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Get statistics about the contact store.
   */
  getStats(): {
    contacts: number;
    identities: number;
    messages: number;
    platforms: Record<string, number>;
  } {
    const contactCount = (
      this.db.prepare(`SELECT COUNT(*) as count FROM contacts`).get() as { count: number }
    ).count;

    const identityCount = (
      this.db.prepare(`SELECT COUNT(*) as count FROM platform_identities`).get() as {
        count: number;
      }
    ).count;

    const messageCount = (
      this.db.prepare(`SELECT COUNT(*) as count FROM indexed_messages`).get() as { count: number }
    ).count;

    const platformRows = this.db
      .prepare(`SELECT platform, COUNT(*) as count FROM platform_identities GROUP BY platform`)
      .all() as Array<{ platform: string; count: number }>;

    const platforms: Record<string, number> = {};
    for (const row of platformRows) {
      platforms[row.platform] = row.count;
    }

    return {
      contacts: contactCount,
      identities: identityCount,
      messages: messageCount,
      platforms,
    };
  }
}

// Singleton instance
let _store: ContactStore | null = null;

/**
 * Get the global contact store instance.
 */
export function getContactStore(): ContactStore {
  if (!_store) {
    _store = ContactStore.open();
  }
  return _store;
}

/**
 * Close the global contact store instance.
 */
export function closeContactStore(): void {
  if (_store) {
    _store.close();
    _store = null;
  }
}
