/**
 * Contacts module - Unified contact graph for cross-platform identity resolution.
 *
 * This module provides:
 * - Canonical contact management (create, link, search)
 * - Platform identity linking (WhatsApp, Telegram, Discord, Slack, Signal, etc.)
 * - Message indexing for cross-platform search
 * - Auto-linking heuristics based on phone/email/name matching
 */

export { ContactStore, getContactStore, closeContactStore } from "./store.js";
export { ensureContactStoreSchema, dropContactStoreTables } from "./schema.js";
export {
  importContactFromMessage,
  extractWhatsAppContact,
  extractTelegramContact,
  extractDiscordContact,
  extractSlackContact,
  extractSignalContact,
  extractIMessageContact,
  importSlackUsers,
  importDiscordGuildMembers,
  importWhatsAppGroupParticipants,
  jidToE164,
  isJidGroup,
} from "./importer.js";
export type {
  Contact,
  ContactSearchOptions,
  ContactWithIdentities,
  ImportResult,
  IndexedMessage,
  LinkConfidence,
  LinkSuggestion,
  MessageSearchOptions,
  MessageSearchResult,
  Platform,
  PlatformIdentity,
  PlatformIdentityInput,
} from "./types.js";
export type { ContactImporter, MessageContactData } from "./importer.js";
export {
  findPhoneMatches,
  findNameMatches,
  findLinkSuggestions,
  linkContacts,
  unlinkIdentity,
  autoLinkHighConfidence,
} from "./linker.js";
