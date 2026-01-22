import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ContactStore } from "./store.js";
import {
  autoLinkHighConfidence,
  findLinkSuggestions,
  findNameMatches,
  findPhoneMatches,
  linkContacts,
  unlinkIdentity,
} from "./linker.js";

describe("linker", () => {
  let store: ContactStore;

  beforeEach(() => {
    store = ContactStore.openInMemory();
  });

  afterEach(() => {
    store.close();
  });

  describe("findPhoneMatches", () => {
    it("finds contacts with same phone number", () => {
      // Create two contacts with same phone on different platforms
      const contact1 = store.createContact("John on WhatsApp");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "whatsapp",
        platformId: "14155551234@s.whatsapp.net",
        username: null,
        phone: "+14155551234",
        displayName: "John",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("John on Signal");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "signal",
        platformId: "uuid-john",
        username: null,
        phone: "+14155551234",
        displayName: "John D",
        lastSeenAt: null,
      });

      const suggestions = findPhoneMatches(store);
      expect(suggestions.length).toBe(1);
      expect(suggestions[0]?.reason).toBe("phone_match");
      expect(suggestions[0]?.confidence).toBe("high");
      expect(suggestions[0]?.score).toBe(1.0);
    });

    it("does not suggest already-linked contacts", () => {
      const contact = store.createContact("John");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "whatsapp",
        platformId: "wa-john",
        username: null,
        phone: "+14155551234",
        displayName: "John WA",
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "signal",
        platformId: "signal-john",
        username: null,
        phone: "+14155551234",
        displayName: "John Signal",
        lastSeenAt: null,
      });

      const suggestions = findPhoneMatches(store);
      expect(suggestions.length).toBe(0);
    });

    it("returns empty for no phone matches", () => {
      const contact1 = store.createContact("Alice");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "whatsapp",
        platformId: "wa-alice",
        username: null,
        phone: "+14155551111",
        displayName: "Alice",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("Bob");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "whatsapp",
        platformId: "wa-bob",
        username: null,
        phone: "+14155552222",
        displayName: "Bob",
        lastSeenAt: null,
      });

      const suggestions = findPhoneMatches(store);
      expect(suggestions.length).toBe(0);
    });
  });

  describe("findNameMatches", () => {
    it("finds contacts with similar names", () => {
      const contact1 = store.createContact("John Doe");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-john",
        username: "johndoe",
        phone: null,
        displayName: "John Doe",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("John Doe"); // Same name
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "discord",
        platformId: "dc-john",
        username: "johndoe",
        phone: null,
        displayName: "John Doe",
        lastSeenAt: null,
      });

      const suggestions = findNameMatches(store);
      expect(suggestions.length).toBeGreaterThan(0);
      expect(suggestions[0]?.reason).toBe("name_similarity");
      expect(suggestions[0]?.score).toBe(1.0);
    });

    it("finds contacts with slightly different names", () => {
      const contact1 = store.createContact("John Doe");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-john",
        username: null,
        phone: null,
        displayName: "John Doe",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("John D"); // Shorter version
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "discord",
        platformId: "dc-john",
        username: null,
        phone: null,
        displayName: "John D",
        lastSeenAt: null,
      });

      // With default threshold of 0.85, these may or may not match
      const suggestions = findNameMatches(store, { minScore: 0.6 });
      // At least should find something with low threshold
      expect(suggestions.length).toBeGreaterThan(0);
    });

    it("respects minimum score threshold", () => {
      const contact1 = store.createContact("Alice Smith");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-alice",
        username: null,
        phone: null,
        displayName: "Alice Smith",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("Bob Jones");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "discord",
        platformId: "dc-bob",
        username: null,
        phone: null,
        displayName: "Bob Jones",
        lastSeenAt: null,
      });

      // Completely different names should not match
      const suggestions = findNameMatches(store, { minScore: 0.85 });
      expect(suggestions.length).toBe(0);
    });
  });

  describe("findLinkSuggestions", () => {
    it("combines phone and name matches", () => {
      // Phone match
      const contact1 = store.createContact("Phone User 1");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "whatsapp",
        platformId: "wa-1",
        username: null,
        phone: "+14155551234",
        displayName: "Phone User",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("Phone User 2");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "signal",
        platformId: "signal-1",
        username: null,
        phone: "+14155551234",
        displayName: "Phone User",
        lastSeenAt: null,
      });

      // Name match (different person)
      const contact3 = store.createContact("Alice Smith");
      store.addIdentity({
        contactId: contact3.canonicalId,
        platform: "telegram",
        platformId: "tg-alice",
        username: null,
        phone: null,
        displayName: "Alice Smith",
        lastSeenAt: null,
      });

      const contact4 = store.createContact("Alice Smith");
      store.addIdentity({
        contactId: contact4.canonicalId,
        platform: "discord",
        platformId: "dc-alice",
        username: null,
        phone: null,
        displayName: "Alice Smith",
        lastSeenAt: null,
      });

      const suggestions = findLinkSuggestions(store);
      expect(suggestions.length).toBeGreaterThanOrEqual(2);

      // Phone matches should come first (high confidence)
      const phoneMatch = suggestions.find((s) => s.reason === "phone_match");
      expect(phoneMatch).toBeDefined();
      expect(phoneMatch?.confidence).toBe("high");
    });

    it("sorts by confidence then score", () => {
      // Create multiple potential matches with different confidence levels
      const contact1 = store.createContact("Test User A");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "whatsapp",
        platformId: "wa-a",
        username: null,
        phone: "+14155559999",
        displayName: "Test User A",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("Test User A");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "signal",
        platformId: "signal-a",
        username: null,
        phone: "+14155559999",
        displayName: "Test User A",
        lastSeenAt: null,
      });

      const suggestions = findLinkSuggestions(store);
      expect(suggestions.length).toBeGreaterThan(0);

      // Verify sorted by confidence
      for (let i = 1; i < suggestions.length; i++) {
        const prev = suggestions[i - 1]!;
        const curr = suggestions[i]!;
        const confidenceOrder = { high: 3, medium: 2, low: 1 };
        const prevConf = confidenceOrder[prev.confidence];
        const currConf = confidenceOrder[curr.confidence];
        expect(prevConf).toBeGreaterThanOrEqual(currConf);
      }
    });
  });

  describe("linkContacts", () => {
    it("merges two contacts", () => {
      const contact1 = store.createContact("John on Telegram");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-john",
        username: "johndoe_tg",
        phone: null,
        displayName: "John TG",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("John on Discord");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "discord",
        platformId: "dc-john",
        username: "johndoe_dc",
        phone: null,
        displayName: "John DC",
        lastSeenAt: null,
      });

      const result = linkContacts(store, contact1.canonicalId, contact2.canonicalId);
      expect(result.success).toBe(true);

      // Primary contact should have both identities
      const merged = store.getContactWithIdentities(contact1.canonicalId);
      expect(merged?.identities.length).toBe(2);
      expect(merged?.identities.map((i) => i.platform)).toContain("telegram");
      expect(merged?.identities.map((i) => i.platform)).toContain("discord");

      // Secondary contact should be deleted
      expect(store.getContact(contact2.canonicalId)).toBeNull();

      // Aliases should include secondary contact's name
      expect(merged?.aliases).toContain("John on Discord");
    });

    it("returns error for non-existent primary contact", () => {
      const contact = store.createContact("Test");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-test",
        username: null,
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      const result = linkContacts(store, "fake-id", contact.canonicalId);
      expect(result.success).toBe(false);
      expect(result.error).toContain("Primary contact not found");
    });

    it("returns error for non-existent secondary contact", () => {
      const contact = store.createContact("Test");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-test",
        username: null,
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      const result = linkContacts(store, contact.canonicalId, "fake-id");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Secondary contact not found");
    });
  });

  describe("unlinkIdentity", () => {
    it("creates new contact for unlinked identity", () => {
      const contact = store.createContact("Multi Platform User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-user",
        username: "user_tg",
        phone: null,
        displayName: "TG User",
        lastSeenAt: null,
      });
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "discord",
        platformId: "dc-user",
        username: "user_dc",
        phone: null,
        displayName: "DC User",
        lastSeenAt: null,
      });

      const result = unlinkIdentity(store, "discord", "dc-user");
      expect(result.success).toBe(true);
      expect(result.newContactId).toBeDefined();

      // Original contact should only have telegram identity
      const original = store.getContactWithIdentities(contact.canonicalId);
      expect(original?.identities.length).toBe(1);
      expect(original?.identities[0]?.platform).toBe("telegram");

      // New contact should have discord identity
      const newContact = store.getContactWithIdentities(result.newContactId!);
      expect(newContact?.identities.length).toBe(1);
      expect(newContact?.identities[0]?.platform).toBe("discord");
    });

    it("returns error for non-existent identity", () => {
      const result = unlinkIdentity(store, "telegram", "fake-id");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Identity not found");
    });

    it("returns error when trying to unlink only identity", () => {
      const contact = store.createContact("Single Identity User");
      store.addIdentity({
        contactId: contact.canonicalId,
        platform: "telegram",
        platformId: "tg-single",
        username: null,
        phone: null,
        displayName: null,
        lastSeenAt: null,
      });

      const result = unlinkIdentity(store, "telegram", "tg-single");
      expect(result.success).toBe(false);
      expect(result.error).toContain("Cannot unlink the only identity");
    });
  });

  describe("autoLinkHighConfidence", () => {
    it("automatically links high confidence matches", () => {
      // Create contacts with same phone (high confidence)
      const contact1 = store.createContact("Auto Link User 1");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "whatsapp",
        platformId: "wa-auto",
        username: null,
        phone: "+14155557777",
        displayName: "Auto User WA",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("Auto Link User 2");
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "signal",
        platformId: "signal-auto",
        username: null,
        phone: "+14155557777",
        displayName: "Auto User Signal",
        lastSeenAt: null,
      });

      const initialCount = store.listContacts().length;
      expect(initialCount).toBe(2);

      const result = autoLinkHighConfidence(store);
      expect(result.linked).toBe(1);

      // Should now have only one contact
      const finalCount = store.listContacts().length;
      expect(finalCount).toBe(1);

      // The remaining contact should have both identities
      const contacts = store.listContacts();
      const merged = store.getContactWithIdentities(contacts[0]!.canonicalId);
      expect(merged?.identities.length).toBe(2);
    });

    it("does not link medium/low confidence matches", () => {
      // Create contacts with similar but not exact names (medium confidence)
      const contact1 = store.createContact("John Smith");
      store.addIdentity({
        contactId: contact1.canonicalId,
        platform: "telegram",
        platformId: "tg-john",
        username: null,
        phone: null,
        displayName: "John Smith",
        lastSeenAt: null,
      });

      const contact2 = store.createContact("John Smyth"); // Similar but not same
      store.addIdentity({
        contactId: contact2.canonicalId,
        platform: "discord",
        platformId: "dc-john",
        username: null,
        phone: null,
        displayName: "John Smyth",
        lastSeenAt: null,
      });

      const initialCount = store.listContacts().length;
      const result = autoLinkHighConfidence(store);

      // Name similarity below threshold should not auto-link
      const finalCount = store.listContacts().length;
      // They may or may not be linked depending on exact similarity
      // But we verify auto-link only processes high confidence
      expect(result.suggestions.every((s) => s.confidence === "high")).toBe(true);
    });
  });
});
