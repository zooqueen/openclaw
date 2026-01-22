/**
 * Contact importers for each messaging platform.
 *
 * Since many platforms don't have bulk contact APIs, importers use a combination of:
 * 1. Direct API calls where available (Slack users.list, Discord members)
 * 2. Message-based discovery (observing incoming messages)
 * 3. Group metadata extraction
 */

import type { ContactStore } from "./store.js";
import type { ImportResult, Platform, PlatformIdentityInput } from "./types.js";

/**
 * Base interface for platform-specific contact importers.
 */
export type ContactImporter = {
  /** Platform this importer handles */
  platform: Platform;

  /** Import contacts from this platform */
  import(store: ContactStore): Promise<ImportResult>;
};

/**
 * Extract E.164 phone number from WhatsApp JID.
 * JID format: "1234567890@s.whatsapp.net" or "1234567890:0@s.whatsapp.net"
 */
export function jidToE164(jid: string): string | null {
  if (!jid) return null;
  // Remove suffix
  const numberPart = jid.split("@")[0];
  if (!numberPart) return null;
  // Handle device suffix (e.g., "1234567890:0")
  const phone = numberPart.split(":")[0];
  if (!phone || !/^\d{7,15}$/.test(phone)) return null;
  return `+${phone}`;
}

/**
 * Check if a JID is a group.
 */
export function isJidGroup(jid: string): boolean {
  return jid.includes("@g.us") || jid.includes("@broadcast");
}

/**
 * Data extracted from an incoming message for contact discovery.
 */
export type MessageContactData = {
  platform: Platform;
  platformId: string;
  username?: string | null;
  phone?: string | null;
  displayName?: string | null;
};

/**
 * Import a contact from message data.
 * Creates a new contact if the platform identity doesn't exist,
 * or updates the existing contact's metadata.
 */
export function importContactFromMessage(
  store: ContactStore,
  data: MessageContactData,
): { contactId: string; isNew: boolean } {
  // Check if identity already exists
  const existing = store.getIdentityByPlatformId(data.platform, data.platformId);
  if (existing) {
    // Update last seen
    store.updateIdentityLastSeen(data.platform, data.platformId);
    return { contactId: existing.contactId, isNew: false };
  }

  // Create new contact and identity
  const displayName = data.displayName || data.username || data.platformId;
  const contact = store.createContact(displayName);

  const input: PlatformIdentityInput = {
    contactId: contact.canonicalId,
    platform: data.platform,
    platformId: data.platformId,
    username: data.username ?? null,
    phone: data.phone ?? null,
    displayName: data.displayName ?? null,
    lastSeenAt: Date.now(),
  };
  store.addIdentity(input);

  return { contactId: contact.canonicalId, isNew: true };
}

/**
 * WhatsApp contact data extraction from message.
 */
export function extractWhatsAppContact(params: {
  senderJid: string;
  pushName?: string | null;
}): MessageContactData | null {
  const { senderJid, pushName } = params;
  if (!senderJid || isJidGroup(senderJid)) return null;

  const phone = jidToE164(senderJid);

  return {
    platform: "whatsapp",
    platformId: senderJid,
    username: null,
    phone,
    displayName: pushName ?? null,
  };
}

/**
 * Telegram contact data extraction from message.
 */
export function extractTelegramContact(params: {
  userId: number | string;
  username?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): MessageContactData | null {
  const { userId, username, firstName, lastName } = params;
  if (!userId) return null;

  const displayName = [firstName, lastName].filter(Boolean).join(" ") || null;

  return {
    platform: "telegram",
    platformId: String(userId),
    username: username ?? null,
    phone: null,
    displayName,
  };
}

/**
 * Discord contact data extraction from message.
 */
export function extractDiscordContact(params: {
  userId: string;
  username?: string | null;
  globalName?: string | null;
  nick?: string | null;
}): MessageContactData | null {
  const { userId, username, globalName, nick } = params;
  if (!userId) return null;

  // Prefer display names: nick > globalName > username
  const displayName = nick || globalName || username || null;

  return {
    platform: "discord",
    platformId: userId,
    username: username ?? null,
    phone: null,
    displayName,
  };
}

/**
 * Slack contact data extraction from message.
 */
export function extractSlackContact(params: {
  userId: string;
  username?: string | null;
  displayName?: string | null;
  realName?: string | null;
}): MessageContactData | null {
  const { userId, username, displayName, realName } = params;
  if (!userId) return null;

  return {
    platform: "slack",
    platformId: userId,
    username: username ?? null,
    phone: null,
    displayName: displayName || realName || null,
  };
}

/**
 * Signal contact data extraction from message.
 */
export function extractSignalContact(params: {
  sourceNumber?: string | null;
  sourceUuid?: string | null;
  sourceName?: string | null;
}): MessageContactData | null {
  const { sourceNumber, sourceUuid, sourceName } = params;

  // Prefer UUID as platformId, fall back to phone
  const platformId = sourceUuid || sourceNumber;
  if (!platformId) return null;

  return {
    platform: "signal",
    platformId,
    username: null,
    phone: sourceNumber ?? null,
    displayName: sourceName ?? null,
  };
}

/**
 * iMessage contact data extraction from message.
 */
export function extractIMessageContact(params: {
  senderId: string;
  senderName?: string | null;
}): MessageContactData | null {
  const { senderId, senderName } = params;
  if (!senderId) return null;

  // iMessage senderId can be phone or email
  const isPhone = /^\+?\d{10,}$/.test(senderId.replace(/\D/g, ""));

  return {
    platform: "imessage",
    platformId: senderId,
    username: null,
    phone: isPhone ? senderId : null,
    displayName: senderName ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// BULK IMPORTERS (for platforms with bulk APIs)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slack bulk importer using users.list API.
 */
export async function importSlackUsers(
  store: ContactStore,
  listUsers: () => Promise<
    Array<{
      id: string;
      name?: string;
      displayName?: string;
      realName?: string;
      email?: string;
      isBot?: boolean;
      deleted?: boolean;
    }>
  >,
): Promise<ImportResult> {
  const result: ImportResult = {
    platform: "slack",
    imported: 0,
    linked: 0,
    errors: [],
  };

  try {
    const users = await listUsers();

    for (const user of users) {
      // Skip bots and deleted users
      if (user.isBot || user.deleted) continue;
      if (!user.id) continue;

      try {
        const data = extractSlackContact({
          userId: user.id,
          username: user.name,
          displayName: user.displayName,
          realName: user.realName,
        });

        if (data) {
          const { isNew } = importContactFromMessage(store, data);
          if (isNew) result.imported++;
        }
      } catch (err) {
        result.errors.push(`Failed to import user ${user.id}: ${err}`);
      }
    }
  } catch (err) {
    result.errors.push(`Failed to list Slack users: ${err}`);
  }

  return result;
}

/**
 * Discord bulk importer using guild member search.
 */
export async function importDiscordGuildMembers(
  store: ContactStore,
  listMembers: () => Promise<
    Array<{
      user: {
        id: string;
        username?: string;
        global_name?: string;
        bot?: boolean;
      };
      nick?: string | null;
    }>
  >,
): Promise<ImportResult> {
  const result: ImportResult = {
    platform: "discord",
    imported: 0,
    linked: 0,
    errors: [],
  };

  try {
    const members = await listMembers();

    for (const member of members) {
      // Skip bots
      if (member.user.bot) continue;
      if (!member.user.id) continue;

      try {
        const data = extractDiscordContact({
          userId: member.user.id,
          username: member.user.username,
          globalName: member.user.global_name,
          nick: member.nick,
        });

        if (data) {
          const { isNew } = importContactFromMessage(store, data);
          if (isNew) result.imported++;
        }
      } catch (err) {
        result.errors.push(`Failed to import member ${member.user.id}: ${err}`);
      }
    }
  } catch (err) {
    result.errors.push(`Failed to list Discord members: ${err}`);
  }

  return result;
}

/**
 * WhatsApp group participants importer.
 */
export async function importWhatsAppGroupParticipants(
  store: ContactStore,
  getGroupMetadata: (groupJid: string) => Promise<{
    subject?: string;
    participants?: Array<{ id: string }>;
  }>,
  groupJid: string,
): Promise<ImportResult> {
  const result: ImportResult = {
    platform: "whatsapp",
    imported: 0,
    linked: 0,
    errors: [],
  };

  try {
    const meta = await getGroupMetadata(groupJid);
    const participants = meta.participants ?? [];

    for (const participant of participants) {
      if (!participant.id) continue;
      if (isJidGroup(participant.id)) continue;

      try {
        const data = extractWhatsAppContact({
          senderJid: participant.id,
          pushName: null, // Group metadata doesn't include push names
        });

        if (data) {
          const { isNew } = importContactFromMessage(store, data);
          if (isNew) result.imported++;
        }
      } catch (err) {
        result.errors.push(`Failed to import participant ${participant.id}: ${err}`);
      }
    }
  } catch (err) {
    result.errors.push(`Failed to get group metadata for ${groupJid}: ${err}`);
  }

  return result;
}
