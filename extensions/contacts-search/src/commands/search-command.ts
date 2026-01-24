import type { PluginChatCommandHandler } from "clawdbot/plugin-sdk";

import { getContactStore } from "../contacts/index.js";
import { parseSearchArgs } from "./search-args.js";

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
 * Handle the /search command for cross-platform message search.
 */
export const handleSearchCommand: PluginChatCommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;

  const normalized = params.command.commandBodyNormalized;
  if (normalized !== "/search" && !normalized.startsWith("/search ")) return null;

  if (!params.command.isAuthorizedSender) {
    return { shouldContinue: false };
  }

  // Parse arguments from commandBodyNormalized (mentions already stripped)
  const parsed = parseSearchArgs(params.command.commandBodyNormalized);
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
