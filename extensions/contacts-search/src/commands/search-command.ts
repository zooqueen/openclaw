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

export function runSearchCommand(commandBody: string): string {
  const parsed = parseSearchArgs(commandBody);
  if (parsed.error) {
    return `❌ ${parsed.error}`;
  }

  try {
    const store = getContactStore();

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
      return msg;
    }

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

    return lines.join("\n").trim();
  } catch (err) {
    return `❌ Search error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
