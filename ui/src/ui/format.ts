export function formatMs(ms?: number | null): string {
  if (!ms && ms !== 0) return "n/a";
  return new Date(ms).toLocaleString();
}

export function formatAgo(ms?: number | null): string {
  if (!ms && ms !== 0) return "n/a";
  const diff = Date.now() - ms;
  if (diff < 0) return "just now";
  const sec = Math.round(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  return `${day}d ago`;
}

export function formatDurationMs(ms?: number | null): string {
  if (!ms && ms !== 0) return "n/a";
  if (ms < 1000) return `${ms}ms`;
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr}h`;
  const day = Math.round(hr / 24);
  return `${day}d`;
}

export function formatList(values?: Array<string | null | undefined>): string {
  if (!values || values.length === 0) return "none";
  return values.filter((v): v is string => Boolean(v && v.trim())).join(", ");
}

export function clampText(value: string, max = 120): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1))}…`;
}

export function truncateText(value: string, max: number): {
  text: string;
  truncated: boolean;
  total: number;
} {
  if (value.length <= max) {
    return { text: value, truncated: false, total: value.length };
  }
  return {
    text: value.slice(0, Math.max(0, max)),
    truncated: true,
    total: value.length,
  };
}

export function toNumber(value: string, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parseList(input: string): string[] {
  return input
    .split(/[,\n]/)
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

<<<<<<< fix/tui-final-tag-strip
const THINKING_TAG_RE = /<\s*\/?\s*(?:think(?:ing)?|final)\s*>/gi;
const THINKING_OPEN_RE = /<\s*(?:think(?:ing)?|final)\s*>/i;
const THINKING_CLOSE_RE = /<\s*\/\s*(?:think(?:ing)?|final)\s*>/i;
||||||| temp/landpr-
const THINKING_TAG_RE = /<\s*\/?\s*think(?:ing)?\s*>/gi;
const THINKING_OPEN_RE = /<\s*think(?:ing)?\s*>/i;
const THINKING_CLOSE_RE = /<\s*\/\s*think(?:ing)?\s*>/i;
=======
const FINAL_TAG_RE = /<\s*\/?\s*final\s*>/gi;
const THINKING_TAG_RE = /<\s*\/?\s*think(?:ing)?\s*>/gi;
const THINKING_OPEN_RE = /<\s*think(?:ing)?\s*>/i;
const THINKING_CLOSE_RE = /<\s*\/\s*think(?:ing)?\s*>/i;
>>>>>>> local

export function stripThinkingTags(value: string): string {
  if (!value) return value;
  let cleaned = value;
  let strippedFinal = false;
  if (FINAL_TAG_RE.test(cleaned)) {
    FINAL_TAG_RE.lastIndex = 0;
    cleaned = cleaned.replace(FINAL_TAG_RE, "");
    strippedFinal = true;
  } else {
    FINAL_TAG_RE.lastIndex = 0;
  }

  const hasOpen = THINKING_OPEN_RE.test(cleaned);
  const hasClose = THINKING_CLOSE_RE.test(cleaned);
  if (!hasOpen && !hasClose) return strippedFinal ? cleaned.trimStart() : cleaned;
  // If we don't have a balanced pair, avoid dropping trailing content.
  if (hasOpen !== hasClose) {
    if (!hasOpen) return cleaned.replace(THINKING_CLOSE_RE, "").trimStart();
    return cleaned.replace(THINKING_OPEN_RE, "").trimStart();
  }

  if (!THINKING_TAG_RE.test(cleaned)) {
    THINKING_TAG_RE.lastIndex = 0;
    return strippedFinal ? cleaned.trimStart() : cleaned;
  }
  THINKING_TAG_RE.lastIndex = 0;

  let result = "";
  let lastIndex = 0;
  let inThinking = false;
  for (const match of cleaned.matchAll(THINKING_TAG_RE)) {
    const idx = match.index ?? 0;
    if (!inThinking) {
      result += cleaned.slice(lastIndex, idx);
    }
    const tag = match[0].toLowerCase();
    inThinking = !tag.includes("/");
    lastIndex = idx + match[0].length;
  }
  if (!inThinking) {
    result += cleaned.slice(lastIndex);
  }
  return result.trimStart();
}
