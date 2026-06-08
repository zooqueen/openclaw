/**
 * Citation redirect resolver for web search results.
 *
 * Follows provider citation redirect URLs with a short HEAD request timeout.
 */
import { buildTimeoutAbortSignal } from "../../utils/fetch-timeout.js";

const REDIRECT_TIMEOUT_MS = 5000;

/**
 * Resolve a citation redirect URL to its final destination using a HEAD request.
 * Returns the original URL if resolution fails or times out.
 */
export async function resolveCitationRedirectUrl(url: string): Promise<string> {
  const timeout = buildTimeoutAbortSignal({
    timeoutMs: REDIRECT_TIMEOUT_MS,
    operation: "web-search-citation-redirect",
    url,
  });
  try {
    const response = await fetch(url, {
      method: "HEAD",
      ...(timeout.signal ? { signal: timeout.signal } : {}),
    });
    await response.body?.cancel().catch(() => undefined);
    return response.url || url;
  } catch {
    return url;
  } finally {
    timeout.cleanup();
  }
}
