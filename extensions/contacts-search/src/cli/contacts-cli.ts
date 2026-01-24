import type { Command } from "commander";

import {
  autoLinkHighConfidence,
  findLinkSuggestions,
  getContactStore,
  linkContacts,
  unlinkIdentity,
} from "../contacts/index.js";
import type { Platform } from "../contacts/types.js";
import { formatDocsLink } from "clawdbot/plugin-sdk";

import { cli, formatDanger, formatSuccess, renderTable, theme } from "./formatting.js";

function formatPlatformList(platforms: string[]): string {
  return platforms.join(", ");
}

function formatContactRow(contact: {
  canonicalId: string;
  displayName: string;
  aliases: string[];
  identities: Array<{ platform: string; platformId: string; username?: string | null }>;
}) {
  const platforms = [...new Set(contact.identities.map((i) => i.platform))];
  return {
    ID: contact.canonicalId,
    Name: contact.displayName,
    Platforms: formatPlatformList(platforms),
    Identities: String(contact.identities.length),
  };
}

export function registerContactsCli(program: Command) {
  const contacts = program
    .command("contacts")
    .description("Unified contact graph - cross-platform identity management")
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink(
          "/cli/contacts",
          "docs.clawd.bot/cli/contacts",
        )}\n`,
    )
    .action(() => {
      contacts.help({ error: true });
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts list
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("list")
    .description("List all contacts in the unified graph")
    .option("--query <text>", "Search by name or alias")
    .option("--platform <name>", "Filter by platform (channel id)")
    .option("--limit <n>", "Limit results", "50")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      try {
        const store = getContactStore();
        const limit = parseInt(opts.limit as string, 10) || 50;

        const platform = opts.platform
          ? ((opts.platform as string).toLowerCase() as Platform)
          : undefined;
        const contactsList = store.listContacts({
          query: opts.query as string | undefined,
          platform,
          limit,
        });

        const contactsWithIdentities = contactsList
          .map((c) => store.getContactWithIdentities(c.canonicalId))
          .filter((c): c is NonNullable<typeof c> => c !== null);

        if (opts.json) {
          cli.log(JSON.stringify(contactsWithIdentities, null, 2));
          return;
        }

        if (contactsWithIdentities.length === 0) {
          cli.log(theme.muted("No contacts found."));
          return;
        }

        const tableWidth = Math.max(80, (process.stdout.columns ?? 120) - 1);
        cli.log(
          `${theme.heading("Contacts")} ${theme.muted(`(${contactsWithIdentities.length})`)}`,
        );
        cli.log(
          renderTable({
            width: tableWidth,
            columns: [
              { key: "ID", header: "ID", minWidth: 20, flex: true },
              { key: "Name", header: "Name", minWidth: 16, flex: true },
              { key: "Platforms", header: "Platforms", minWidth: 20, flex: true },
              { key: "Identities", header: "#", minWidth: 4 },
            ],
            rows: contactsWithIdentities.map(formatContactRow),
          }).trimEnd(),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts show
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("show")
    .description("Show details for a specific contact")
    .argument("<id>", "Contact canonical ID or search query")
    .option("--json", "Output JSON", false)
    .action(async (id: string, opts) => {
      try {
        const store = getContactStore();

        // Try exact match first
        let contact = store.getContactWithIdentities(id);

        // If not found, search
        if (!contact) {
          const matches = store.searchContacts(id, 1);
          contact = matches[0] ?? null;
        }

        if (!contact) {
          cli.error(formatDanger(`Contact not found: ${id}`));
          cli.exit(1);
          return;
        }

        if (opts.json) {
          cli.log(JSON.stringify(contact, null, 2));
          return;
        }

        cli.log(`${theme.heading("Contact")}`);
        cli.log(`  ID: ${contact.canonicalId}`);
        cli.log(`  Name: ${contact.displayName}`);
        if (contact.aliases.length > 0) {
          cli.log(`  Aliases: ${contact.aliases.join(", ")}`);
        }

        cli.log("");
        cli.log(
          `${theme.heading("Platform Identities")} (${contact.identities.length})`,
        );

        const tableWidth = Math.max(80, (process.stdout.columns ?? 120) - 1);
        cli.log(
          renderTable({
            width: tableWidth,
            columns: [
              { key: "Platform", header: "Platform", minWidth: 10 },
              { key: "ID", header: "Platform ID", minWidth: 20, flex: true },
              { key: "Username", header: "Username", minWidth: 12, flex: true },
              { key: "Phone", header: "Phone", minWidth: 14 },
            ],
            rows: contact.identities.map((i) => ({
              Platform: i.platform,
              ID: i.platformId,
              Username: i.username ?? "",
              Phone: i.phone ?? "",
            })),
          }).trimEnd(),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts search
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("search")
    .description("Search contacts by name, alias, or username")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Limit results", "10")
    .option("--json", "Output JSON", false)
    .action(async (query: string, opts) => {
      try {
        const store = getContactStore();
        const limit = parseInt(opts.limit as string, 10) || 10;
        const results = store.searchContacts(query, limit);

        if (opts.json) {
          cli.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          cli.log(theme.muted(`No contacts found matching "${query}".`));
          return;
        }

        const tableWidth = Math.max(80, (process.stdout.columns ?? 120) - 1);
        cli.log(
          `${theme.heading("Search Results")} ${theme.muted(`(${results.length})`)}`,
        );
        cli.log(
          renderTable({
            width: tableWidth,
            columns: [
              { key: "ID", header: "ID", minWidth: 20, flex: true },
              { key: "Name", header: "Name", minWidth: 16, flex: true },
              { key: "Platforms", header: "Platforms", minWidth: 20, flex: true },
              { key: "Identities", header: "#", minWidth: 4 },
            ],
            rows: results.map(formatContactRow),
          }).trimEnd(),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts link
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("link")
    .description("Link two contacts (merge into one)")
    .argument("<primary>", "Primary contact ID (will keep this one)")
    .argument("<secondary>", "Secondary contact ID (will be merged and deleted)")
    .action(async (primary: string, secondary: string) => {
      try {
        const store = getContactStore();
        const result = linkContacts(store, primary, secondary);

        if (!result.success) {
          cli.error(formatDanger(result.error ?? "Failed to link contacts"));
          cli.exit(1);
          return;
        }

        cli.log(formatSuccess(`Linked: ${secondary} merged into ${primary}`));
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts unlink
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("unlink")
    .description("Unlink a platform identity from its contact (creates a new contact)")
    .argument("<platform>", "Platform (channel id)")
    .argument("<platformId>", "Platform-specific user ID")
    .action(async (platform: string, platformId: string) => {
      try {
        const store = getContactStore();
        const result = unlinkIdentity(store, platform, platformId);

        if (!result.success) {
          cli.error(formatDanger(result.error ?? "Failed to unlink identity"));
          cli.exit(1);
          return;
        }

        cli.log(
          formatSuccess(
            `Unlinked: ${platform}:${platformId} → new contact ${result.newContactId}`,
          ),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts suggestions
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("suggestions")
    .description("Show link suggestions (contacts that may be the same person)")
    .option("--min-score <n>", "Minimum name similarity score (0-1)", "0.85")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      try {
        const store = getContactStore();
        const minScore = parseFloat(opts.minScore as string) || 0.85;
        const suggestions = findLinkSuggestions(store, { minNameScore: minScore });

        if (opts.json) {
          cli.log(JSON.stringify(suggestions, null, 2));
          return;
        }

        if (suggestions.length === 0) {
          cli.log(theme.muted("No link suggestions found."));
          return;
        }

        cli.log(
          `${theme.heading("Link Suggestions")} ${theme.muted(`(${suggestions.length})`)}`,
        );

        const tableWidth = Math.max(100, (process.stdout.columns ?? 120) - 1);
        cli.log(
          renderTable({
            width: tableWidth,
            columns: [
              { key: "Source", header: "Source", minWidth: 20, flex: true },
              { key: "Target", header: "Target", minWidth: 20, flex: true },
              { key: "Reason", header: "Reason", minWidth: 14 },
              { key: "Confidence", header: "Confidence", minWidth: 10 },
              { key: "Score", header: "Score", minWidth: 6 },
            ],
            rows: suggestions.map((s) => ({
              Source: `${s.sourceIdentity.platform}:${s.sourceIdentity.displayName || s.sourceIdentity.platformId}`,
              Target: `${s.targetIdentity.platform}:${s.targetIdentity.displayName || s.targetIdentity.platformId}`,
              Reason: s.reason,
              Confidence: s.confidence,
              Score: s.score.toFixed(2),
            })),
          }).trimEnd(),
        );

        cli.log("");
        cli.log(
          theme.muted("To link: clawdbot contacts link <source-contact-id> <target-contact-id>"),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts auto-link
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("auto-link")
    .description("Automatically link high-confidence matches (e.g., same phone number)")
    .option("--dry-run", "Show what would be linked without making changes", false)
    .action(async (opts) => {
      try {
        const store = getContactStore();

        if (opts.dryRun) {
          const suggestions = findLinkSuggestions(store);
          const highConfidence = suggestions.filter((s) => s.confidence === "high");

          if (highConfidence.length === 0) {
            cli.log(theme.muted("No high-confidence matches found."));
            return;
          }

          cli.log(
            `${theme.heading("Would auto-link")} ${theme.muted(`(${highConfidence.length})`)}`,
          );
          for (const s of highConfidence) {
            cli.log(
              `  ${s.sourceIdentity.contactId} + ${s.targetIdentity.contactId} (${s.reason})`,
            );
          }
          return;
        }

        const result = autoLinkHighConfidence(store);

        if (result.linked === 0) {
          cli.log(theme.muted("No high-confidence matches found to auto-link."));
          return;
        }

        cli.log(formatSuccess(`Auto-linked ${result.linked} contact(s)`));
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts stats
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("stats")
    .description("Show contact store statistics")
    .option("--json", "Output JSON", false)
    .action(async (opts) => {
      try {
        const store = getContactStore();
        const stats = store.getStats();

        if (opts.json) {
          cli.log(JSON.stringify(stats, null, 2));
          return;
        }

        cli.log(`${theme.heading("Contact Store Statistics")}`);
        cli.log(`  Contacts: ${stats.contacts}`);
        cli.log(`  Identities: ${stats.identities}`);
        cli.log(`  Indexed Messages: ${stats.messages}`);
        cli.log("");
        cli.log(`${theme.heading("Identities by Platform")}`);
        for (const [platform, count] of Object.entries(stats.platforms)) {
          cli.log(`  ${platform}: ${count}`);
        }
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });

  // ─────────────────────────────────────────────────────────────────────────────
  // contacts alias
  // ─────────────────────────────────────────────────────────────────────────────

  contacts
    .command("alias")
    .description("Add or remove an alias for a contact")
    .argument("<contactId>", "Contact ID")
    .argument("<alias>", "Alias to add")
    .option("--remove", "Remove the alias instead of adding", false)
    .action(async (contactId: string, alias: string, opts) => {
      try {
        const store = getContactStore();
        const contact = store.getContact(contactId);

        if (!contact) {
          cli.error(formatDanger(`Contact not found: ${contactId}`));
          cli.exit(1);
          return;
        }

        const currentAliases = contact.aliases;
        let newAliases: string[];

        if (opts.remove) {
          newAliases = currentAliases.filter((a) => a !== alias);
          if (newAliases.length === currentAliases.length) {
            cli.log(theme.muted(`Alias "${alias}" not found on this contact.`));
            return;
          }
        } else {
          if (currentAliases.includes(alias)) {
            cli.log(theme.muted(`Alias "${alias}" already exists on this contact.`));
            return;
          }
          newAliases = [...currentAliases, alias];
        }

        store.updateContact(contactId, { aliases: newAliases });
        cli.log(
          formatSuccess(
            opts.remove ? `Removed alias "${alias}"` : `Added alias "${alias}"`,
          ),
        );
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });
}
