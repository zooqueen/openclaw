import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContactStore } from "./store.js";
import type { Platform } from "./types.js";

describe("ContactStore", () => {
  let store: ContactStore;

  beforeEach(() => {
    store = ContactStore.openInMemory();
  });

  afterEach(() => {
    store.close();
  });

  describe("contacts", () => {
    it("creates a contact with generated canonical ID", () => {
      const contact = store.createContact("Sarah Jones");
      expect(contact.canonicalId).toMatch(/^sarah-jones-[a-f0-9]{8}$/);
      expect(contact.displayName).toBe("Sarah Jones");
      expect(contact.aliases).toEqual([]);
      expect(contact.createdAt).toBeGreaterThan(0);
      expect(contact.updatedAt).toBe(contact.createdAt);
    });

    it("creates a contact with aliases", () => {
      const contact = store.createContact("Bob Smith", ["Bobby", "Bob S"]);
      expect(contact.aliases).toEqual(["Bobby", "Bob S"]);
    });

    it("retrieves a contact by canonical ID", () => {
      const created = store.createContact("Alice Doe");
      const retrieved = store.getContact(created.canonicalId);
      expect(retrieved).toEqual(created);
    });

    it("returns null for non-existent contact", () => {
      const retrieved = store.getContact("non-existent-id");
      expect(retrieved).toBeNull();
    });

    it("updates contact display name", () => {
      const contact = store.createContact("Old Name");
      const success = store.updateContact(contact.canonicalId, { displayName: "New Name" });
      expect(success).toBe(true);

      const updated = store.getContact(contact.canonicalId);
      expect(updated?.displayName).toBe("New Name");
      // updatedAt should be >= createdAt (may be same millisecond in fast tests)
      expect(updated?.updatedAt).toBeGreaterThanOrEqual(contact.updatedAt);
    });

    it("updates contact aliases", () => {
      const contact = store.createContact("Test User");
      store.updateContact(contact.canonicalId, { aliases: ["Tester", "TU"] });

      const updated = store.getContact(contact.canonicalId);
      expect(updated?.aliases).toEqual(["Tester", "TU"]);
    });

    it("returns false when updating non-existent contact", () => {
      const success = store.updateContact("fake-id", { displayName: "Test" });
      expect(success).toBe(false);
    });

    it("deletes a contact", () => {
      const contact = store.createContact("To Delete");
      expect(store.getContact(contact.canonicalId)).not.toBeNull();

      const deleted = store.deleteContact(contact.canonicalId);
      expect(deleted).toBe(true);
      expect(store.getContact(contact.canonicalId)).toBeNull();
    });

    it("returns false when deleting non-existent contact", () => {
      const deleted = store.deleteContact("fake-id");
      expect(deleted).toBe(false);
    });

    it("lists all contacts", () => {
      store.createContact("Alpha User");
      store.createContact("Beta User");
      store.createContact("Gamma User");

      const contacts = store.listContacts();
      expect(contacts.length).toBe(3);
    });

    it("lists contacts with query filter", () => {
      store.createContact("John Doe");
      store.createContact("Jane Doe", ["Janey"]);
      store.createContact("Bob Smith");

      const contacts = store.listContacts({ query: "doe" });
      expect(contacts.length).toBe(2);
    });

    it("lists contacts with limit", () => {
      store.createContact("User 1");
      store.createContact("User 2");
      store.createContact("User 3");

      const contacts = store.listContacts({ limit: 2 });
      expect(contacts.length).toBe(2);
    });
  });

  describe("platform identities", () => {
    it("adds a platform identity to a contact", () => {
      const contact = store.createContact("Test User");
      const identity = store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "123456789",
        username: "testuser",
        phone: null,
        displayName: "Test User",
        lastSeenAt: null,
      });

      expect(identity.id).toBeGreaterThan(0);
      expect(identity.contactId).toBe(contact.canonicalId);
      expect(identity.platform).toBe("telegram");
      expect(identity.platformId).toBe("123456789");
    });

    it("retrieves identities by contact ID", () => {
      const contact = store.createContact("Multi Platform User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-123",
        username: "teleuser",
        phone: null,
        displayName: "Tele User",
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "discord",
        platformId: "dc-456",
        username: "discorduser",
        phone: null,
        displayName: "Discord User",
        lastSeenAt: null,
      });

      const identities = store.getIdentitiesByContact(contact.canonicalId);
      expect(identities.length).toBe(2);
      expect(identities.map((i) => i.platform)).toContain("telegram");
      expect(identities.map((i) => i.platform)).toContain("discord");
    });

    it("retrieves identity by platform and platform ID", () => {
      const contact = store.createContact("User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "whatsapp",
        platformId: "+14155551234@s.whatsapp.net",
        username: null,
        phone: "+14155551234",
        displayName: "WA User",
        lastSeenAt: null,
      });

      const identity = store.getIdentityByPlatformId("whatsapp", "+14155551234@s.whatsapp.net");
      expect(identity).not.toBeNull();
      expect(identity?.contactId).toBe(contact.canonicalId);
      expect(identity?.phone).toBe("+14155551234");
    });

    it("returns null for non-existent identity", () => {
      const identity = store.getIdentityByPlatformId("telegram", "fake-id");
      expect(identity).toBeNull();
    });

    it("finds identities by phone number", () => {
      const contact = store.createContact("Phone User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "whatsapp",
        platformId: "wa-jid-1",
        username: null,
        phone: "+14155551234",
        displayName: "WA User",
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "signal",
        platformId: "signal-uuid-1",
        username: null,
        phone: "+14155551234",
        displayName: "Signal User",
        lastSeenAt: null,
      });

      const identities = store.findIdentitiesByPhone("+14155551234");
      expect(identities.length).toBe(2);
    });

    it("updates last seen timestamp", () => {
      const contact = store.createContact("User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-id",
        username: "user",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      store.updateIdentityLastSeen("telegram", "tg-id");
      const identity = store.getIdentityByPlatformId("telegram", "tg-id");
      expect(identity?.lastSeenAt).toBeGreaterThan(0);
    });

    it("resolves platform sender to contact ID", () => {
      const contact = store.createContact("Resolvable User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "discord",
        platformId: "discord-user-id",
        username: "discorduser",
        phone: null,
        displayName: "Discord Display",
        lastSeenAt: null,
      });

      const resolved = store.resolveContact("discord", "discord-user-id");
      expect(resolved).toBe(contact.canonicalId);
    });

    it("returns null when resolving unknown sender", () => {
      const resolved = store.resolveContact("telegram", "unknown-id");
      expect(resolved).toBeNull();
    });
  });

  describe("contact search", () => {
    it("searches contacts by display name", () => {
      store.createContact("Alice Wonderland");
      store.createContact("Bob Builder");
      store.createContact("Alice Cooper");

      const results = store.searchContacts("alice");
      expect(results.length).toBe(2);
      expect(results.map((r) => r.displayName)).toContain("Alice Wonderland");
      expect(results.map((r) => r.displayName)).toContain("Alice Cooper");
    });

    it("searches contacts by username", () => {
      const contact = store.createContact("John Doe");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-john",
        username: "johndoe",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      const results = store.searchContacts("johndoe");
      expect(results.length).toBe(1);
      expect(results[0]?.displayName).toBe("John Doe");
    });

    it("returns contact with all identities", () => {
      const contact = store.createContact("Multi User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-multi",
        username: "multi_tg",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "slack",
        platformId: "slack-multi",
        username: "multi_slack",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      const results = store.searchContacts("multi");
      expect(results.length).toBe(1);
      expect(results[0]?.identities.length).toBe(2);
    });
  });

  describe("message indexing", () => {
    it("indexes a message", () => {
      store.indexMessage({
        id: "msg-1",
        content: "Hello, this is a test message",
        platform: "telegram" as Platform,
        senderId: "sender-123",
        channelId: "channel-456",
        timestamp: Date.now(),
      });

      const stats = store.getStats();
      expect(stats.messages).toBe(1);
    });

    it("links message to contact when sender is resolved", () => {
      const contact = store.createContact("Known Sender");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "sender-known",
        username: "known",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      store.indexMessage({
        id: "msg-linked",
        content: "Message from known sender",
        platform: "telegram" as Platform,
        senderId: "sender-known",
        channelId: "chat-1",
        timestamp: Date.now(),
      });

      // Search should find the message
      const results = store.searchMessages({ query: "known sender" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.message.contactId).toBe(contact.canonicalId);
    });

    it("searches messages by content", () => {
      store.indexMessage({
        id: "msg-search-1",
        content: "The quick brown fox jumps over the lazy dog",
        platform: "telegram" as Platform,
        senderId: "s1",
        channelId: "c1",
        timestamp: Date.now(),
      });
      store.indexMessage({
        id: "msg-search-2",
        content: "A slow red turtle crawls under the fence",
        platform: "discord" as Platform,
        senderId: "s2",
        channelId: "c2",
        timestamp: Date.now(),
      });

      const results = store.searchMessages({ query: "quick fox" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.message.id).toBe("msg-search-1");
    });

    it("filters messages by platform", () => {
      store.indexMessage({
        id: "msg-tg",
        content: "Telegram message about deadlines",
        platform: "telegram" as Platform,
        senderId: "s1",
        channelId: "c1",
        timestamp: Date.now(),
      });
      store.indexMessage({
        id: "msg-dc",
        content: "Discord message about deadlines",
        platform: "discord" as Platform,
        senderId: "s2",
        channelId: "c2",
        timestamp: Date.now(),
      });

      const results = store.searchMessages({
        query: "deadlines",
        platforms: ["telegram"],
      });
      expect(results.length).toBe(1);
      expect(results[0]?.message.platform).toBe("telegram");
    });

    it("filters messages by timestamp range", () => {
      const now = Date.now();
      store.indexMessage({
        id: "msg-old",
        content: "Old message about projects",
        platform: "telegram" as Platform,
        senderId: "s1",
        channelId: "c1",
        timestamp: now - 7 * 24 * 60 * 60 * 1000, // 7 days ago
      });
      store.indexMessage({
        id: "msg-new",
        content: "New message about projects",
        platform: "telegram" as Platform,
        senderId: "s1",
        channelId: "c1",
        timestamp: now,
      });

      const results = store.searchMessages({
        query: "projects",
        since: now - 24 * 60 * 60 * 1000, // Last 24 hours
      });
      expect(results.length).toBe(1);
      expect(results[0]?.message.id).toBe("msg-new");
    });

    it("creates snippet with context", () => {
      store.indexMessage({
        id: "msg-snippet",
        content:
          "This is a very long message that contains the word deadline somewhere in the middle and continues with more text after that point to test the snippet creation functionality.",
        platform: "telegram" as Platform,
        senderId: "s1",
        channelId: "c1",
        timestamp: Date.now(),
      });

      const results = store.searchMessages({ query: "deadline" });
      expect(results.length).toBeGreaterThan(0);
      expect(results[0]?.snippet).toContain("deadline");
      expect(results[0]?.snippet.length).toBeLessThan(250);
    });
  });

  describe("getContactWithIdentities", () => {
    it("returns contact with all platform identities", () => {
      const contact = store.createContact("Full Contact");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-full",
        username: "full_tg",
        phone: "+14155551111",
        displayName: "TG Full",
        lastSeenAt: Date.now(),
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "whatsapp",
        platformId: "wa-full",
        username: null,
        phone: "+14155551111",
        displayName: "WA Full",
        lastSeenAt: null,
      });

      const result = store.getContactWithIdentities(contact.canonicalId);
      expect(result).not.toBeNull();
      expect(result?.displayName).toBe("Full Contact");
      expect(result?.identities.length).toBe(2);
    });

    it("returns null for non-existent contact", () => {
      const result = store.getContactWithIdentities("fake-id");
      expect(result).toBeNull();
    });
  });

  describe("statistics", () => {
    it("returns accurate stats", () => {
      const contact1 = store.createContact("Stats User 1");
      const contact2 = store.createContact("Stats User 2");

      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-stats-1",
        username: "stats1",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "discord",
        platformId: "dc-stats-1",
        username: "stats1dc",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "telegram",
        platformId: "tg-stats-2",
        username: "stats2",
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      store.indexMessage({
        id: "stats-msg-1",
        content: "Stats test message",
        platform: "telegram" as Platform,
        senderId: "tg-stats-1",
        channelId: "c1",
        timestamp: Date.now(),
      });

      const stats = store.getStats();
      expect(stats.contacts).toBe(2);
      expect(stats.identities).toBe(3);
      expect(stats.messages).toBe(1);
      expect(stats.platforms.telegram).toBe(2);
      expect(stats.platforms.discord).toBe(1);
    });
  });
});
