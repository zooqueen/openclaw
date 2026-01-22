/**
 * Types for the unified contact graph.
 *
 * The contact graph allows cross-platform identity resolution:
 * - Multiple platform identities can be linked to a single canonical contact
 * - Enables unified message search across all messaging channels
 */

/**
 * A canonical contact in the unified contact graph.
 * Represents a single person who may have multiple platform identities.
 */
export type Contact = {
  /** Unique canonical identifier (e.g., "sarah-jones-abc123") */
  canonicalId: string;
  /** Primary display name for this contact */
  displayName: string;
  /** Alternative names/aliases for this contact */
  aliases: string[];
  /** When this contact was first created */
  createdAt: number;
  /** When this contact was last updated */
  updatedAt: number;
};

/**
 * Supported messaging platforms.
 */
export type Platform =
  | "whatsapp"
  | "telegram"
  | "discord"
  | "slack"
  | "signal"
  | "imessage"
  | "matrix"
  | "msteams";

/**
 * A platform-specific identity linked to a canonical contact.
 * Each person may have one or more of these across different platforms.
 */
export type PlatformIdentity = {
  /** Database row ID */
  id: number;
  /** Reference to the canonical contact */
  contactId: string;
  /** Which platform this identity belongs to */
  platform: Platform;
  /** Platform-specific user identifier (JID, user ID, etc.) */
  platformId: string;
  /** Platform-specific username (@handle) if available */
  username: string | null;
  /** E.164 phone number if available */
  phone: string | null;
  /** Platform-specific display name */
  displayName: string | null;
  /** When this identity was last seen in a message */
  lastSeenAt: number | null;
};

/**
 * Input for creating a new platform identity.
 */
export type PlatformIdentityInput = Omit<PlatformIdentity, "id">;

/**
 * Result of a contact search/lookup.
 */
export type ContactWithIdentities = Contact & {
  /** All platform identities associated with this contact */
  identities: PlatformIdentity[];
};

/**
 * Auto-link match confidence levels.
 */
export type LinkConfidence = "high" | "medium" | "low";

/**
 * A suggested link between platform identities.
 */
export type LinkSuggestion = {
  /** The source identity that was analyzed */
  sourceIdentity: PlatformIdentity;
  /** The target identity to potentially link with */
  targetIdentity: PlatformIdentity;
  /** Why this link is suggested */
  reason: "phone_match" | "email_match" | "name_similarity";
  /** How confident we are in this match */
  confidence: LinkConfidence;
  /** Score for ranking (0-1) */
  score: number;
};

/**
 * Contact import result from a platform.
 */
export type ImportResult = {
  platform: Platform;
  imported: number;
  linked: number;
  errors: string[];
};

/**
 * Options for contact search.
 */
export type ContactSearchOptions = {
  /** Search query (matches name, aliases, username) */
  query?: string;
  /** Filter by platform */
  platform?: Platform;
  /** Maximum results to return */
  limit?: number;
};

/**
 * A message indexed for cross-platform search.
 */
export type IndexedMessage = {
  /** Unique message ID */
  id: string;
  /** Message content (may be empty for media) */
  content: string;
  /** Reference to canonical contact ID of sender */
  contactId: string | null;
  /** Platform this message came from */
  platform: Platform;
  /** Platform-specific sender ID */
  senderId: string;
  /** Platform-specific channel/chat ID */
  channelId: string;
  /** When the message was sent */
  timestamp: number;
  /** Optional: pre-computed embedding for semantic search */
  embedding: string | null;
};

/**
 * Options for message search.
 */
export type MessageSearchOptions = {
  /** Text query to search for */
  query: string;
  /** Filter by sender (canonical contact ID or platform identity) */
  from?: string;
  /** Filter by platform */
  platforms?: Platform[];
  /** Filter by channel/chat ID */
  channelId?: string;
  /** Filter messages after this timestamp */
  since?: number;
  /** Filter messages before this timestamp */
  until?: number;
  /** Maximum results */
  limit?: number;
};

/**
 * Message search result.
 */
export type MessageSearchResult = {
  message: IndexedMessage;
  /** The contact who sent this message (if resolved) */
  contact: Contact | null;
  /** Search relevance score */
  score: number;
  /** Snippet with highlighted match */
  snippet: string;
};
