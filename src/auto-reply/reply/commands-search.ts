import { logVerbose } from "../../globals.js";
import { getContactStore } from "../../contacts/index.js";
import type { Platform } from "../../contacts/types.js";
import type { CommandHandler } from "./commands-types.js";

const VALID_PLATFORMS: Platform[] = [
  "whatsapp",
  "telegram",
  "discord",
  "slack",
  "signal",
  "imessage",
];

/**
 * Parse relative time strings like "1h", "2d", "1w"
 */
function parseRelativeTime(value: string): number | null {
  const match = value.match(/^(\d+)([hdwm])$/i);
  if (!match) return null;

  const amount = parseInt(match[1]!, 10);
  const unit = match[2]!.toLowerCase();
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
    default:
      return null;
  }
}

/**
 * Format a timestamp for display
 */
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

/**
 * Parse search command arguments.
 * Format: /search <query> [--from <contact>] [--platform <name>] [--since <time>]
 */
function parseSearchArgs(commandBody: string): {
  query: string;
  from?: string;
  platform?: Platform;
  since?: number;
  error?: string;
} {
  // Remove the /search prefix
  const argsStr = commandBody.replace(/^\/search\s*/i, "").trim();
  if (!argsStr) {
    return {
      query: "",
      error: "Usage: /search <query> [--from <contact>] [--platform <name>] [--since <time>]",
    };
  }

  let query = "";
  let from: string | undefined;
  let platform: Platform | undefined;
  let since: number | undefined;

  // Parse options
  const parts = argsStr.split(/\s+/);
  const queryParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part === "--from" && i + 1 < parts.length) {
      from = parts[++i];
    } else if (part === "--platform" && i + 1 < parts.length) {
      const p = parts[++i]!.toLowerCase() as Platform;
      if (!VALID_PLATFORMS.includes(p)) {
        return { query: "", error: `Invalid platform: ${p}. Valid: ${VALID_PLATFORMS.join(", ")}` };
      }
      platform = p;
    } else if (part === "--since" && i + 1 < parts.length) {
      const timeStr = parts[++i]!;
      const parsed = parseRelativeTime(timeStr);
      if (parsed === null) {
        return {
          query: "",
          error: `Invalid --since value: ${timeStr}. Use format like 1h, 2d, 1w, 1m`,
        };
      }
      since = parsed;
    } else if (part.startsWith("--")) {
      return { query: "", error: `Unknown option: ${part}` };
    } else {
      queryParts.push(part);
    }
  }

  query = queryParts.join(" ");
  if (!query) {
    return {
      query: "",
      error: "Usage: /search <query> [--from <contact>] [--platform <name>] [--since <time>]",
    };
  }

  return { query, from, platform, since };
}

/**
 * Handle the /search command for cross-platform message search.
 */
export const handleSearchCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;

  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/search" && !normalized.startsWith("/search ")) return null;

  if (!params.command.isAuthorizedSender) {
    logVerbose(
      `Ignoring /search from unauthorized sender: ${params.command.senderId || "<unknown>"}`,
    );
    return { shouldContinue: false };
  }

  // Parse arguments - use rawBodyNormalized which preserves the original text
  const parsed = parseSearchArgs(params.command.rawBodyNormalized);
  if (parsed.error) {
    return {
      shouldContinue: false,
      reply: { text: `❌ ${parsed.error}` },
    };
  }

  try {
    const store = getContactStore();

    // Search messages
    const results = store.searchMessages({
      query: parsed.query,
      from: parsed.from,
      platforms: parsed.platform ? [parsed.platform] : undefined,
      since: parsed.since,
      limit: 10,
    });

    if (results.length === 0) {
      let msg = `🔍 No messages found matching "${parsed.query}"`;
      if (parsed.from) {
        const contactMatches = store.searchContacts(parsed.from, 5);
        if (contactMatches.length === 0) {
          msg += `\n\n⚠️ Note: No contacts found matching "${parsed.from}"`;
        }
      }
      return {
        shouldContinue: false,
        reply: { text: msg },
      };
    }

    // Format results
    const lines = [`🔍 Search Results (${results.length})\n`];

    for (const result of results) {
      const { message, contact, snippet } = result;
      const senderName = contact?.displayName ?? message.senderId;
      const time = formatTimestamp(message.timestamp);
      const platformLabel = message.platform.toUpperCase();

      lines.push(`[${platformLabel}] ${senderName} - ${time}`);
      lines.push(`  ${snippet}`);
      lines.push("");
    }

    if (results.length === 10) {
      lines.push('Use the CLI for more results: clawdbot search "' + parsed.query + '" --limit 50');
    }

    return {
      shouldContinue: false,
      reply: { text: lines.join("\n").trim() },
    };
  } catch (err) {
    return {
      shouldContinue: false,
      reply: { text: `❌ Search error: ${err instanceof Error ? err.message : String(err)}` },
    };
  }
};
