/**
 * Auto-linking heuristics for the unified contact graph.
 *
 * This module provides algorithms to automatically detect and suggest
 * links between platform identities that likely belong to the same person.
 *
 * Linking heuristics (in priority order):
 * 1. Phone match: Same E.164 phone across platforms (high confidence)
 * 2. Name similarity: Fuzzy name matching with high threshold (medium confidence)
 */

import type { ContactStore } from "./store.js";
import type { LinkConfidence, LinkSuggestion, PlatformIdentity } from "./types.js";

/**
 * Calculate Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize matrix
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0]![j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const cost = a[j - 1] === b[i - 1] ? 0 : 1;
      matrix[i]![j] = Math.min(
        matrix[i - 1]![j]! + 1, // deletion
        matrix[i]![j - 1]! + 1, // insertion
        matrix[i - 1]![j - 1]! + cost, // substitution
      );
    }
  }

  return matrix[b.length]![a.length]!;
}

/**
 * Calculate similarity score between two strings (0-1).
 * 1 = identical, 0 = completely different.
 */
function calculateSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;

  // Normalize: lowercase, trim, remove extra whitespace
  const normalizedA = a.toLowerCase().trim().replace(/\s+/g, " ");
  const normalizedB = b.toLowerCase().trim().replace(/\s+/g, " ");

  if (normalizedA === normalizedB) return 1;
  if (normalizedA.length === 0 || normalizedB.length === 0) return 0;

  const maxLength = Math.max(normalizedA.length, normalizedB.length);
  const distance = levenshteinDistance(normalizedA, normalizedB);

  return 1 - distance / maxLength;
}

/**
 * Normalize a phone number for comparison.
 * Strips non-digit characters except leading +.
 */
function normalizePhone(phone: string | null): string | null {
  if (!phone) return null;
  // Keep only digits and leading +
  let normalized = phone.replace(/[^+\d]/g, "");
  // Ensure it starts with +
  if (!normalized.startsWith("+") && normalized.length >= 10) {
    // Assume US if 10 digits without country code
    if (normalized.length === 10) {
      normalized = `+1${normalized}`;
    } else {
      normalized = `+${normalized}`;
    }
  }
  return normalized.length >= 10 ? normalized : null;
}

/**
 * Find link suggestions based on phone number matching.
 * This is the highest confidence match since phone numbers are unique identifiers.
 */
export function findPhoneMatches(store: ContactStore): LinkSuggestion[] {
  const suggestions: LinkSuggestion[] = [];

  // Get all contacts with their identities
  const contacts = store.listContacts();

  // Build phone → identities map
  const phoneToIdentities = new Map<string, PlatformIdentity[]>();

  for (const contact of contacts) {
    const withIdentities = store.getContactWithIdentities(contact.canonicalId);
    if (!withIdentities) continue;

    for (const identity of withIdentities.identities) {
      const phone = normalizePhone(identity.phone);
      if (!phone) continue;

      const existing = phoneToIdentities.get(phone) ?? [];
      existing.push(identity);
      phoneToIdentities.set(phone, existing);
    }
  }

  // Find identities with same phone but different contacts
  for (const [_phone, identities] of phoneToIdentities) {
    if (identities.length < 2) continue;

    // Group by contact ID
    const byContact = new Map<string, PlatformIdentity[]>();
    for (const identity of identities) {
      const existing = byContact.get(identity.contactId) ?? [];
      existing.push(identity);
      byContact.set(identity.contactId, existing);
    }

    // If all belong to same contact, already linked
    if (byContact.size < 2) continue;

    // Create suggestions for each pair of contacts
    const contactIds = Array.from(byContact.keys());
    for (let i = 0; i < contactIds.length; i++) {
      for (let j = i + 1; j < contactIds.length; j++) {
        const sourceIdentity = byContact.get(contactIds[i]!)![0]!;
        const targetIdentity = byContact.get(contactIds[j]!)![0]!;

        suggestions.push({
          sourceIdentity,
          targetIdentity,
          reason: "phone_match",
          confidence: "high",
          score: 1.0,
        });
      }
    }
  }

  return suggestions;
}

/**
 * Find link suggestions based on name similarity.
 * Uses fuzzy matching with a configurable threshold.
 */
export function findNameMatches(
  store: ContactStore,
  options: { minScore?: number } = {},
): LinkSuggestion[] {
  const { minScore = 0.85 } = options;
  const suggestions: LinkSuggestion[] = [];

  // Get all contacts with their identities
  const contacts = store.listContacts();
  const contactsWithIdentities = contacts
    .map((c) => store.getContactWithIdentities(c.canonicalId))
    .filter((c): c is NonNullable<typeof c> => c !== null);

  // Compare each pair of contacts
  for (let i = 0; i < contactsWithIdentities.length; i++) {
    for (let j = i + 1; j < contactsWithIdentities.length; j++) {
      const contactA = contactsWithIdentities[i]!;
      const contactB = contactsWithIdentities[j]!;

      // Skip if already same contact
      if (contactA.canonicalId === contactB.canonicalId) continue;

      // Compare display names
      const similarity = calculateSimilarity(contactA.displayName, contactB.displayName);

      if (similarity >= minScore) {
        // Get representative identities for the suggestion
        const sourceIdentity = contactA.identities[0];
        const targetIdentity = contactB.identities[0];

        if (sourceIdentity && targetIdentity) {
          suggestions.push({
            sourceIdentity,
            targetIdentity,
            reason: "name_similarity",
            confidence: similarity >= 0.95 ? "high" : "medium",
            score: similarity,
          });
        }
      }

      // Also compare identity display names
      for (const identityA of contactA.identities) {
        for (const identityB of contactB.identities) {
          if (!identityA.displayName || !identityB.displayName) continue;

          const identitySimilarity = calculateSimilarity(
            identityA.displayName,
            identityB.displayName,
          );

          if (identitySimilarity >= minScore) {
            // Avoid duplicate suggestions
            const alreadySuggested = suggestions.some(
              (s) =>
                (s.sourceIdentity.id === identityA.id && s.targetIdentity.id === identityB.id) ||
                (s.sourceIdentity.id === identityB.id && s.targetIdentity.id === identityA.id),
            );

            if (!alreadySuggested) {
              suggestions.push({
                sourceIdentity: identityA,
                targetIdentity: identityB,
                reason: "name_similarity",
                confidence: identitySimilarity >= 0.95 ? "high" : "medium",
                score: identitySimilarity,
              });
            }
          }
        }
      }
    }
  }

  return suggestions;
}

/**
 * Find all link suggestions across all heuristics.
 * Returns suggestions sorted by confidence and score.
 */
export function findLinkSuggestions(
  store: ContactStore,
  options: { minNameScore?: number } = {},
): LinkSuggestion[] {
  const phoneSuggestions = findPhoneMatches(store);
  const nameSuggestions = findNameMatches(store, { minScore: options.minNameScore });

  // Combine and sort by confidence (high first) then score
  const all = [...phoneSuggestions, ...nameSuggestions];

  const confidenceOrder: Record<LinkConfidence, number> = {
    high: 3,
    medium: 2,
    low: 1,
  };

  return all.sort((a, b) => {
    const confDiff = confidenceOrder[b.confidence] - confidenceOrder[a.confidence];
    if (confDiff !== 0) return confDiff;
    return b.score - a.score;
  });
}

/**
 * Link two contacts by merging all identities into the primary contact.
 * The secondary contact is deleted.
 */
export function linkContacts(
  store: ContactStore,
  primaryContactId: string,
  secondaryContactId: string,
): { success: boolean; error?: string } {
  const primary = store.getContactWithIdentities(primaryContactId);
  const secondary = store.getContactWithIdentities(secondaryContactId);

  if (!primary) {
    return { success: false, error: `Primary contact not found: ${primaryContactId}` };
  }
  if (!secondary) {
    return { success: false, error: `Secondary contact not found: ${secondaryContactId}` };
  }

  // Move all identities from secondary to primary
  for (const identity of secondary.identities) {
    store.addIdentity({
      contactId: primary.canonicalId,
      platform: identity.platform,
      platformId: identity.platformId,
      username: identity.username,
      phone: identity.phone,
      displayName: identity.displayName,
      lastSeenAt: identity.lastSeenAt,
    });
  }

  // Merge aliases
  const newAliases = [...primary.aliases];
  if (!newAliases.includes(secondary.displayName)) {
    newAliases.push(secondary.displayName);
  }
  for (const alias of secondary.aliases) {
    if (!newAliases.includes(alias)) {
      newAliases.push(alias);
    }
  }
  store.updateContact(primary.canonicalId, { aliases: newAliases });

  // Delete secondary contact
  store.deleteContact(secondaryContactId);

  return { success: true };
}

/**
 * Unlink a platform identity from its current contact.
 * Creates a new contact for the identity.
 */
export function unlinkIdentity(
  store: ContactStore,
  platform: string,
  platformId: string,
): { success: boolean; newContactId?: string; error?: string } {
  const identity = store.getIdentityByPlatformId(platform, platformId);
  if (!identity) {
    return { success: false, error: `Identity not found: ${platform}:${platformId}` };
  }

  const currentContact = store.getContactWithIdentities(identity.contactId);
  if (!currentContact) {
    return { success: false, error: `Contact not found: ${identity.contactId}` };
  }

  // If this is the only identity, nothing to unlink
  if (currentContact.identities.length === 1) {
    return { success: false, error: "Cannot unlink the only identity from a contact" };
  }

  // Create new contact for this identity
  const displayName = identity.displayName || identity.username || identity.platformId;
  const newContact = store.createContact(displayName);

  // Move the identity to the new contact
  store.addIdentity({
    contactId: newContact.canonicalId,
    platform: identity.platform,
    platformId: identity.platformId,
    username: identity.username,
    phone: identity.phone,
    displayName: identity.displayName,
    lastSeenAt: identity.lastSeenAt,
  });

  return { success: true, newContactId: newContact.canonicalId };
}

/**
 * Auto-apply high-confidence link suggestions.
 * Returns the number of links applied.
 */
export function autoLinkHighConfidence(store: ContactStore): {
  linked: number;
  suggestions: LinkSuggestion[];
} {
  const suggestions = findLinkSuggestions(store);
  const highConfidence = suggestions.filter((s) => s.confidence === "high");

  let linked = 0;
  const processedContacts = new Set<string>();

  for (const suggestion of highConfidence) {
    const sourceContactId = suggestion.sourceIdentity.contactId;
    const targetContactId = suggestion.targetIdentity.contactId;

    // Skip if either contact was already processed (merged into another)
    if (processedContacts.has(sourceContactId) || processedContacts.has(targetContactId)) {
      continue;
    }

    // Skip if same contact (already linked)
    if (sourceContactId === targetContactId) {
      continue;
    }

    const result = linkContacts(store, sourceContactId, targetContactId);
    if (result.success) {
      linked++;
      processedContacts.add(targetContactId);
    }
  }

  return { linked, suggestions: highConfidence };
}
