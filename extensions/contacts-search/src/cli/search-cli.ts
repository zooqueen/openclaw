import type { Command } from "commander";

import { formatDocsLink } from "clawdbot/plugin-sdk";

import { getContactStore } from "../contacts/index.js";
import type { Platform } from "../contacts/types.js";
import { cli, formatDanger, theme } from "./formatting.js";

function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) {
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) {
    return "Yesterday";
  }
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: "short" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function parseTimestamp(value: string): number | null {
  if (!value) return null;

  // Handle relative times like "1h", "2d", "1w"
  const relativeMatch = value.match(/^(\d+)([hdwm])$/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]!, 10);
    const unit = relativeMatch[2]!.toLowerCase();
    const now = Date.now();
    switch (unit) {
      case "h":
        return now - amount * 60 * 60 * 1000;
      case "d":
        return now - amount * 24 * 60 * 60 * 1000;
      case "w":
        return now - amount * 7 * 24 * 60 * 60 * 1000;
      case "m":
        return now - amount * 30 * 24 * 60 * 60 * 1000;
    }
  }

  // Handle ISO date strings
  const parsed = Date.parse(value);
  if (!isNaN(parsed)) {
    return parsed;
  }

  return null;
}

export function registerSearchCli(program: Command) {
  program
    .command("search")
    .description("Search messages across all messaging platforms")
    .argument("<query>", "Search query")
    .option("--from <contact>", "Filter by sender (contact name, username, or ID)")
    .option(
      "--platform <name>",
      "Filter by platform (channel id)",
    )
    .option("--since <time>", "Filter messages after this time (e.g., 1h, 2d, 1w, or ISO date)")
    .option("--until <time>", "Filter messages before this time")
    .option("--limit <n>", "Limit results", "20")
    .option("--json", "Output JSON", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Examples:")}\n` +
        `  clawdbot search "meeting tomorrow"\n` +
        `  clawdbot search "deadline" --from alice\n` +
        `  clawdbot search "project" --platform slack --since 1w\n` +
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/search", "docs.clawd.bot/cli/search")}\n`,
    )
    .action(async (query: string, opts) => {
      try {
        const store = getContactStore();
        const limit = parseInt(opts.limit as string, 10) || 20;

        // Parse platforms
        let platforms: Platform[] | undefined;
        if (opts.platform) {
          const platform = (opts.platform as string).toLowerCase() as Platform;
          platforms = [platform];
        }

        // Parse timestamps
        const since = opts.since ? parseTimestamp(opts.since as string) : undefined;
        const until = opts.until ? parseTimestamp(opts.until as string) : undefined;

        if (opts.since && since === null) {
          cli.error(formatDanger(`Invalid --since value: ${opts.since}`));
          cli.exit(1);
          return;
        }
        if (opts.until && until === null) {
          cli.error(formatDanger(`Invalid --until value: ${opts.until}`));
          cli.exit(1);
          return;
        }

        const results = store.searchMessages({
          query,
          from: opts.from as string | undefined,
          platforms,
          since: since ?? undefined,
          until: until ?? undefined,
          limit,
        });

        if (opts.json) {
          cli.log(JSON.stringify(results, null, 2));
          return;
        }

        if (results.length === 0) {
          cli.log(theme.muted(`No messages found matching "${query}".`));

          // Helpful hints
          if (opts.from) {
            const contactMatches = store.searchContacts(opts.from as string, 5);
            if (contactMatches.length === 0) {
              cli.log(theme.muted(`Note: No contacts found matching "${opts.from}".`));
            }
          }
          return;
        }

        cli.log(
          `${theme.heading("Search Results")} ${theme.muted(`(${results.length})`)}`,
        );
        cli.log("");

        for (const result of results) {
          const { message, contact, snippet } = result;
          const senderName = contact?.displayName ?? message.senderId;
          const time = formatTimestamp(message.timestamp);

          cli.log(
            `${theme.accent(`[${message.platform}]`)} ${theme.accentBright(senderName)} ${theme.muted(`- ${time}`)}`,
          );
          cli.log(`  ${snippet}`);
          cli.log("");
        }

        if (results.length === limit) {
          cli.log(
            theme.muted(`Showing first ${limit} results. Use --limit to see more.`),
          );
        }
      } catch (err) {
        cli.error(formatDanger(String(err)));
        cli.exit(1);
      }
    });
}
