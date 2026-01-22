import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContactStore } from "./store.js";
import {
  extractDiscordContact,
  extractIMessageContact,
  extractSignalContact,
  extractSlackContact,
  extractTelegramContact,
  extractWhatsAppContact,
  importContactFromMessage,
  importDiscordGuildMembers,
  importSlackUsers,
  importWhatsAppGroupParticipants,
  isJidGroup,
  jidToE164,
} from "./importer.js";

describe("jidToE164", () => {
  it("extracts phone from standard JID", () => {
    expect(jidToE164("14155551234@s.whatsapp.net")).toBe("+14155551234");
  });

  it("extracts phone from JID with device suffix", () => {
    expect(jidToE164("14155551234:0@s.whatsapp.net")).toBe("+14155551234");
  });

  it("returns null for invalid JID", () => {
    expect(jidToE164("")).toBeNull();
    expect(jidToE164("invalid")).toBeNull();
    expect(jidToE164("abc@s.whatsapp.net")).toBeNull();
  });

  it("returns null for group JID", () => {
    // Group JIDs don't have phone numbers
    expect(jidToE164("123456789-1234567890@g.us")).toBeNull();
  });
});

describe("isJidGroup", () => {
  it("returns true for group JIDs", () => {
    expect(isJidGroup("123456789-1234567890@g.us")).toBe(true);
    expect(isJidGroup("status@broadcast")).toBe(true);
  });

  it("returns false for user JIDs", () => {
    expect(isJidGroup("14155551234@s.whatsapp.net")).toBe(false);
  });
});

describe("extractWhatsAppContact", () => {
  it("extracts contact data from sender JID", () => {
    const data = extractWhatsAppContact({
      senderJid: "14155551234@s.whatsapp.net",
      pushName: "John Doe",
    });
    expect(data).toEqual({
      platform: "whatsapp",
      platformId: "14155551234@s.whatsapp.net",
      username: null,
      phone: "+14155551234",
      displayName: "John Doe",
    });
  });

  it("returns null for group JID", () => {
    const data = extractWhatsAppContact({
      senderJid: "123-456@g.us",
      pushName: "Group Name",
    });
    expect(data).toBeNull();
  });

  it("handles missing push name", () => {
    const data = extractWhatsAppContact({
      senderJid: "14155551234@s.whatsapp.net",
    });
    expect(data?.displayName).toBeNull();
  });
});

describe("extractTelegramContact", () => {
  it("extracts contact data from user info", () => {
    const data = extractTelegramContact({
      userId: 123456789,
      username: "johndoe",
      firstName: "John",
      lastName: "Doe",
    });
    expect(data).toEqual({
      platform: "telegram",
      platformId: "123456789",
      username: "johndoe",
      phone: null,
      displayName: "John Doe",
    });
  });

  it("handles missing fields", () => {
    const data = extractTelegramContact({
      userId: 123456789,
    });
    expect(data?.username).toBeNull();
    expect(data?.displayName).toBeNull();
  });

  it("handles first name only", () => {
    const data = extractTelegramContact({
      userId: 123456789,
      firstName: "John",
    });
    expect(data?.displayName).toBe("John");
  });
});

describe("extractDiscordContact", () => {
  it("extracts contact data from user info", () => {
    const data = extractDiscordContact({
      userId: "123456789012345678",
      username: "johndoe",
      globalName: "John Doe",
      nick: "Johnny",
    });
    expect(data).toEqual({
      platform: "discord",
      platformId: "123456789012345678",
      username: "johndoe",
      phone: null,
      displayName: "Johnny", // Nick takes precedence
    });
  });

  it("falls back to globalName when no nick", () => {
    const data = extractDiscordContact({
      userId: "123456789012345678",
      username: "johndoe",
      globalName: "John Doe",
    });
    expect(data?.displayName).toBe("John Doe");
  });

  it("falls back to username when no globalName", () => {
    const data = extractDiscordContact({
      userId: "123456789012345678",
      username: "johndoe",
    });
    expect(data?.displayName).toBe("johndoe");
  });
});

describe("extractSlackContact", () => {
  it("extracts contact data from user info", () => {
    const data = extractSlackContact({
      userId: "U12345678",
      username: "john.doe",
      displayName: "John Doe",
      realName: "John Michael Doe",
    });
    expect(data).toEqual({
      platform: "slack",
      platformId: "U12345678",
      username: "john.doe",
      phone: null,
      displayName: "John Doe", // displayName takes precedence
    });
  });

  it("falls back to realName when no displayName", () => {
    const data = extractSlackContact({
      userId: "U12345678",
      username: "john.doe",
      realName: "John Doe",
    });
    expect(data?.displayName).toBe("John Doe");
  });
});

describe("extractSignalContact", () => {
  it("extracts contact data from signal envelope", () => {
    const data = extractSignalContact({
      sourceNumber: "+14155551234",
      sourceUuid: "uuid-123-456",
      sourceName: "John Doe",
    });
    expect(data).toEqual({
      platform: "signal",
      platformId: "uuid-123-456", // UUID preferred
      username: null,
      phone: "+14155551234",
      displayName: "John Doe",
    });
  });

  it("uses phone as platformId when no UUID", () => {
    const data = extractSignalContact({
      sourceNumber: "+14155551234",
      sourceName: "John Doe",
    });
    expect(data?.platformId).toBe("+14155551234");
  });

  it("returns null when no identifier", () => {
    const data = extractSignalContact({
      sourceName: "John Doe",
    });
    expect(data).toBeNull();
  });
});

describe("extractIMessageContact", () => {
  it("extracts contact from phone number", () => {
    const data = extractIMessageContact({
      senderId: "+14155551234",
      senderName: "John Doe",
    });
    expect(data).toEqual({
      platform: "imessage",
      platformId: "+14155551234",
      username: null,
      phone: "+14155551234",
      displayName: "John Doe",
    });
  });

  it("extracts contact from email", () => {
    const data = extractIMessageContact({
      senderId: "john@example.com",
      senderName: "John Doe",
    });
    expect(data).toEqual({
      platform: "imessage",
      platformId: "john@example.com",
      username: null,
      phone: null, // Email is not a phone
      displayName: "John Doe",
    });
  });
});

describe("importContactFromMessage", () => {
  let store: ContactStore;

  beforeEach(() => {
    store = ContactStore.openInMemory();
  });

  afterEach(() => {
    store.close();
  });

  it("creates new contact for unknown sender", () => {
    const { contactId, isNew } = importContactFromMessage(store, {
      platform: "telegram",
      platformId: "123456789",
      username: "johndoe",
      displayName: "John Doe",
      phone: null,
    });

    expect(isNew).toBe(true);
    expect(contactId).toMatch(/^john-doe-[a-f0-9]{8}$/);

    const contact = store.getContactWithIdentities(contactId);
    expect(contact?.displayName).toBe("John Doe");
    expect(contact?.identities.length).toBe(1);
    expect(contact?.identities[0]?.platform).toBe("telegram");
  });

  it("returns existing contact for known sender", () => {
    // First import
    const first = importContactFromMessage(store, {
      platform: "telegram",
      platformId: "123456789",
      username: "johndoe",
      displayName: "John Doe",
      phone: null,
    });
    expect(first.isNew).toBe(true);

    // Second import of same sender
    const second = importContactFromMessage(store, {
      platform: "telegram",
      platformId: "123456789",
      username: "johndoe",
      displayName: "John Doe",
      phone: null,
    });
    expect(second.isNew).toBe(false);
    expect(second.contactId).toBe(first.contactId);
  });

  it("uses platformId as displayName fallback", () => {
    const { contactId } = importContactFromMessage(store, {
      platform: "whatsapp",
      platformId: "14155551234@s.whatsapp.net",
      username: null,
      displayName: null,
      phone: "+14155551234",
    });

    const contact = store.getContact(contactId);
    expect(contact?.displayName).toBe("14155551234@s.whatsapp.net");
  });
});

describe("bulk importers", () => {
  let store: ContactStore;

  beforeEach(() => {
    store = ContactStore.openInMemory();
  });

  afterEach(() => {
    store.close();
  });

  describe("importSlackUsers", () => {
    it("imports users from Slack API response", async () => {
      const mockUsers = [
        { id: "U1", name: "alice", displayName: "Alice", isBot: false },
        { id: "U2", name: "bob", realName: "Bob Smith", isBot: false },
        { id: "U3", name: "bot", displayName: "Bot", isBot: true }, // Should be skipped
        { id: "U4", name: "deleted", displayName: "Deleted", deleted: true }, // Should be skipped
      ];

      const result = await importSlackUsers(store, async () => mockUsers);

      expect(result.platform).toBe("slack");
      expect(result.imported).toBe(2); // Only Alice and Bob
      expect(result.errors.length).toBe(0);

      const contacts = store.listContacts();
      expect(contacts.length).toBe(2);
    });

    it("handles API errors gracefully", async () => {
      const result = await importSlackUsers(store, async () => {
        throw new Error("API error");
      });

      expect(result.imported).toBe(0);
      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain("Failed to list Slack users");
    });
  });

  describe("importDiscordGuildMembers", () => {
    it("imports members from Discord API response", async () => {
      const mockMembers = [
        { user: { id: "1", username: "alice", global_name: "Alice" }, nick: null },
        { user: { id: "2", username: "bob", global_name: "Bob" }, nick: "Bobby" },
        { user: { id: "3", username: "botuser", bot: true } }, // Should be skipped
      ];

      const result = await importDiscordGuildMembers(store, async () => mockMembers);

      expect(result.platform).toBe("discord");
      expect(result.imported).toBe(2);
      expect(result.errors.length).toBe(0);

      const contacts = store.listContacts();
      expect(contacts.length).toBe(2);
    });
  });

  describe("importWhatsAppGroupParticipants", () => {
    it("imports participants from group metadata", async () => {
      const mockGetMetadata = async (_jid: string) => ({
        subject: "Test Group",
        participants: [
          { id: "14155551111@s.whatsapp.net" },
          { id: "14155552222@s.whatsapp.net" },
          { id: "123-456@g.us" }, // Group JID should be skipped
        ],
      });

      const result = await importWhatsAppGroupParticipants(store, mockGetMetadata, "123-456@g.us");

      expect(result.platform).toBe("whatsapp");
      expect(result.imported).toBe(2);
      expect(result.errors.length).toBe(0);
    });
  });
});
