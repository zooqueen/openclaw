import type { Entry } from "./update-clawtributors.types.js";

export type RenderableClawtributorEntry = Pick<Entry, "display" | "html_url" | "avatar_url">;

export type RenderClawtributorsBlockOptions = {
  perLine: number;
  avatarSize: number;
  startMarker: string;
  endMarker: string;
};

export function renderClawtributorsBlock(
  entries: readonly RenderableClawtributorEntry[],
  options: RenderClawtributorsBlockOptions,
): string {
  const lines = renderClawtributorsLines(entries, options.perLine, options.avatarSize);
  const block = `${options.startMarker}\n${lines.join("\n")}\n${options.endMarker}`;
  const renderedCount = parseRenderedClawtributorEntries(block).length;
  if (renderedCount !== entries.length) {
    throw new Error(
      `Rendered clawtributors count mismatch: expected ${entries.length}, got ${renderedCount}`,
    );
  }
  return block;
}

export function renderClawtributorsLines(
  entries: readonly RenderableClawtributorEntry[],
  perLine: number,
  avatarSize: number,
): string[] {
  const lines: string[] = [];
  for (let i = 0; i < entries.length; i += perLine) {
    const chunk = entries.slice(i, i + perLine);
    const parts = chunk.map((entry) => renderClawtributorEntry(entry, avatarSize));
    lines.push(parts.join(" "));
  }
  return lines;
}

export function renderClawtributorEntry(
  entry: RenderableClawtributorEntry,
  avatarSize: number,
): string {
  const size = String(avatarSize);
  const label = escapeHtmlAttribute(entry.display);
  return `<a href="${escapeHtmlAttribute(entry.html_url)}"><img src="${escapeHtmlAttribute(entry.avatar_url)}" width="${size}" height="${size}" alt="${label}" title="${label}"/></a>`;
}

export function parseRenderedClawtributorEntries(
  content: string,
): Array<{ display: string; html_url: string; avatar_url: string }> {
  const entries: Array<{ display: string; html_url: string; avatar_url: string }> = [];
  const markdown = /\[!\[([^\]]+)\]\(([^)]+)\)\]\(([^)]+)\)/g;
  for (const match of content.matchAll(markdown)) {
    const [, alt, src, href] = match;
    if (!href || !src || !alt) {
      continue;
    }
    entries.push({ html_url: href, avatar_url: src, display: alt.replace(/\\([\\[\]])/g, "$1") });
  }
  const linked = /<a href="([^"]+)"><img src="([^"]+)"[^>]*alt="([^"]+)"[^>]*>/g;
  for (const match of content.matchAll(linked)) {
    const [, href, src, alt] = match;
    if (!href || !src || !alt) {
      continue;
    }
    entries.push({
      html_url: decodeHtmlAttribute(href),
      avatar_url: decodeHtmlAttribute(src),
      display: decodeHtmlAttribute(alt),
    });
  }
  const standalone = /<img src="([^"]+)"[^>]*alt="([^"]+)"[^>]*>/g;
  for (const match of content.matchAll(standalone)) {
    const [, src, alt] = match;
    if (!src || !alt) {
      continue;
    }
    const decodedSrc = decodeHtmlAttribute(src);
    const decodedAlt = decodeHtmlAttribute(alt);
    if (entries.some((entry) => entry.display === decodedAlt && entry.avatar_url === decodedSrc)) {
      continue;
    }
    entries.push({
      html_url: fallbackHref(decodedAlt),
      avatar_url: decodedSrc,
      display: decodedAlt,
    });
  }
  return entries;
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function decodeHtmlAttribute(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function fallbackHref(value: string): string {
  const encoded = encodeURIComponent(value.trim());
  return encoded ? `https://github.com/search?q=${encoded}` : "https://github.com";
}
