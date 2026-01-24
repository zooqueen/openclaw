import type { Platform } from "../contacts/types.js";

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
 * Parse search command arguments.
 * Format: /search <query> [--from <contact>] [--platform <name>] [--since <time>]
 */
function tokenizeArgs(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|\S+/g;
  for (const match of input.matchAll(pattern)) {
    const raw = match[1] ?? match[2] ?? match[0];
    tokens.push(raw.replace(/\\(["'\\])/g, "$1"));
  }
  return tokens;
}

export function parseSearchArgs(commandBody: string): {
  query: string;
  from?: string;
  platform?: Platform;
  since?: number;
  error?: string;
} {
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

  const parts = tokenizeArgs(argsStr);
  const queryParts: string[] = [];

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;

    if (part === "--from" && i + 1 < parts.length) {
      const fromParts: string[] = [];
      while (i + 1 < parts.length && !parts[i + 1]!.startsWith("--")) {
        fromParts.push(parts[++i]!);
      }
      if (fromParts.length === 0) {
        return { query: "", error: "Missing value for --from" };
      }
      from = fromParts.join(" ");
    } else if (part === "--platform" && i + 1 < parts.length) {
      platform = parts[++i]!.toLowerCase() as Platform;
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
