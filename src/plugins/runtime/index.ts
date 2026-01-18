import { createRequire } from "node:module";

import { chunkMarkdownText, resolveTextChunkLimit } from "../../auto-reply/chunk.js";
import { hasControlCommand } from "../../auto-reply/command-detection.js";
import { createInboundDebouncer, resolveInboundDebounceMs } from "../../auto-reply/inbound-debounce.js";
import { buildMentionRegexes, matchesMentionPatterns } from "../../auto-reply/reply/mentions.js";
import { dispatchReplyWithBufferedBlockDispatcher } from "../../auto-reply/reply/provider-dispatcher.js";
import { createReplyDispatcherWithTyping } from "../../auto-reply/reply/reply-dispatcher.js";
import { resolveEffectiveMessagesConfig, resolveHumanDelayConfig } from "../../agents/identity.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../channels/command-gating.js";
import { resolveChannelGroupPolicy, resolveChannelGroupRequireMention } from "../../config/group-policy.js";
import { resolveStateDir } from "../../config/paths.js";
import { shouldLogVerbose } from "../../globals.js";
import { getChildLogger } from "../../logging.js";
import { fetchRemoteMedia } from "../../media/fetch.js";
import { saveMediaBuffer } from "../../media/store.js";
import { buildPairingReply } from "../../pairing/pairing-messages.js";
import { readChannelAllowFromStore, upsertChannelPairingRequest } from "../../pairing/pairing-store.js";
import { resolveAgentRoute } from "../../routing/resolve-route.js";

import type { PluginRuntime } from "./types.js";

let cachedVersion: string | null = null;

function resolveVersion(): string {
  if (cachedVersion) return cachedVersion;
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("../../../package.json") as { version?: string };
    cachedVersion = pkg.version ?? "unknown";
    return cachedVersion;
  } catch {
    cachedVersion = "unknown";
    return cachedVersion;
  }
}

export function createPluginRuntime(): PluginRuntime {
  return {
    version: resolveVersion(),
    channel: {
      text: {
        chunkMarkdownText,
        resolveTextChunkLimit,
        hasControlCommand,
      },
      reply: {
        dispatchReplyWithBufferedBlockDispatcher: async (params) => {
          await dispatchReplyWithBufferedBlockDispatcher(
            params as Parameters<typeof dispatchReplyWithBufferedBlockDispatcher>[0],
          );
        },
        createReplyDispatcherWithTyping: (...args) =>
          createReplyDispatcherWithTyping(
            ...(args as Parameters<typeof createReplyDispatcherWithTyping>),
          ),
        resolveEffectiveMessagesConfig,
        resolveHumanDelayConfig,
      },
      routing: {
        resolveAgentRoute: (params) =>
          resolveAgentRoute(params as Parameters<typeof resolveAgentRoute>[0]),
      },
      pairing: {
        buildPairingReply,
        readAllowFromStore: readChannelAllowFromStore,
        upsertPairingRequest: upsertChannelPairingRequest,
      },
      media: {
        fetchRemoteMedia,
        saveMediaBuffer: (buffer, contentType, direction, maxBytes) =>
          saveMediaBuffer(
            Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
            contentType,
            direction,
            maxBytes,
          ),
      },
      mentions: {
        buildMentionRegexes,
        matchesMentionPatterns,
      },
      groups: {
        resolveGroupPolicy: (cfg, channel, accountId, groupId) =>
          resolveChannelGroupPolicy({
            cfg,
            channel: channel as Parameters<typeof resolveChannelGroupPolicy>[0]["channel"],
            accountId,
            groupId,
          }),
        resolveRequireMention: (cfg, channel, accountId, groupId, override) =>
          resolveChannelGroupRequireMention({
            cfg,
            channel: channel as Parameters<typeof resolveChannelGroupRequireMention>[0]["channel"],
            accountId,
            groupId,
            requireMentionOverride: override,
          }),
      },
      debounce: {
        createInboundDebouncer: (opts) => {
          const keys = new Set<string>();
          const debouncer = createInboundDebouncer({
            debounceMs: opts.debounceMs,
            buildKey: (item) => {
              const key = opts.buildKey(item);
              if (key) keys.add(key);
              return key;
            },
            shouldDebounce: opts.shouldDebounce,
            onFlush: opts.onFlush,
            onError: opts.onError ? (err) => opts.onError?.(err) : undefined,
          });
          return {
            push: (value) => {
              void debouncer.enqueue(value);
            },
            flush: async () => {
              const pending = Array.from(keys);
              keys.clear();
              await Promise.all(pending.map((key) => debouncer.flushKey(key)));
            },
          };
        },
        resolveInboundDebounceMs: (cfg, channel) => resolveInboundDebounceMs({ cfg, channel }),
      },
      commands: {
        resolveCommandAuthorizedFromAuthorizers,
      },
    },
    logging: {
      shouldLogVerbose,
      getChildLogger: (bindings, opts) => {
        const logger = getChildLogger(
          bindings,
          opts as Parameters<typeof getChildLogger>[1],
        );
        return {
          debug: (message) => logger.debug?.(message),
          info: (message) => logger.info(message),
          warn: (message) => logger.warn(message),
          error: (message) => logger.error(message),
        };
      },
    },
    state: {
      resolveStateDir: () => resolveStateDir(),
    },
  };
}

export type { PluginRuntime } from "./types.js";
