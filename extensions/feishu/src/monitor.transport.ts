import crypto from "node:crypto";
import * as http from "node:http";
import * as Lark from "@larksuiteoapi/node-sdk";
import { waitForAbortableDelay } from "./async.js";
import { createFeishuWSClient, type FeishuWSClientLifecycleCallbacks } from "./client.js";
import {
  applyBasicWebhookRequestGuards,
  type RuntimeEnv,
  installRequestBodyLimitGuard,
  readWebhookBodyOrReject,
  safeEqualSecret,
} from "./monitor-transport-runtime-api.js";
import {
  botNames,
  botOpenIds,
  FEISHU_WEBHOOK_BODY_TIMEOUT_MS,
  FEISHU_WEBHOOK_MAX_BODY_BYTES,
  feishuWebhookRateLimiter,
  httpServers,
  recordWebhookStatus,
  wsClients,
} from "./monitor.state.js";
import type { ResolvedFeishuAccount } from "./types.js";

export type MonitorTransportParams = {
  account: ResolvedFeishuAccount;
  accountId: string;
  runtime?: RuntimeEnv;
  abortSignal?: AbortSignal;
  eventDispatcher: Lark.EventDispatcher;
};

const FEISHU_WS_RECONNECT_INITIAL_DELAY_MS = 1_000;
const FEISHU_WS_RECONNECT_MAX_DELAY_MS = 30_000;
const FEISHU_WS_SUPERVISOR_POLL_MS = 5_000;
const FEISHU_WS_RECONNECT_STALL_GRACE_MS = 60_000;
const FEISHU_WS_LOG_ERROR_MAX_LENGTH = 500;

function isFeishuWebhookPayload(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function buildFeishuWebhookEnvelope(
  req: http.IncomingMessage,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return Object.assign(Object.create({ headers: req.headers }), payload) as Record<string, unknown>;
}

function parseFeishuWebhookPayload(rawBody: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(rawBody) as unknown;
    return isFeishuWebhookPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isFeishuWebhookSignatureValid(params: {
  headers: http.IncomingHttpHeaders;
  rawBody: string;
  encryptKey?: string;
}): boolean {
  const encryptKey = params.encryptKey?.trim();
  if (!encryptKey) {
    return false;
  }

  const timestampHeader = params.headers["x-lark-request-timestamp"];
  const nonceHeader = params.headers["x-lark-request-nonce"];
  const signatureHeader = params.headers["x-lark-signature"];
  const timestamp = Array.isArray(timestampHeader) ? timestampHeader[0] : timestampHeader;
  const nonce = Array.isArray(nonceHeader) ? nonceHeader[0] : nonceHeader;
  const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
  if (!timestamp || !nonce || !signature) {
    return false;
  }

  const computedSignature = crypto
    .createHash("sha256")
    .update(timestamp + nonce + encryptKey + params.rawBody)
    .digest("hex");
  return safeEqualSecret(computedSignature, signature);
}

function respondText(res: http.ServerResponse, statusCode: number, body: string): void {
  res.statusCode = statusCode;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.end(body);
}

function getFeishuWsReconnectDelayMs(attempt: number): number {
  return Math.min(
    FEISHU_WS_RECONNECT_INITIAL_DELAY_MS * 2 ** Math.max(0, attempt - 1),
    FEISHU_WS_RECONNECT_MAX_DELAY_MS,
  );
}

function formatFeishuWsErrorForLog(err: unknown): string {
  const raw = err instanceof Error ? err.message || err.name : String(err);
  const singleLine = Array.from(raw, (char) => {
    const code = char.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : char;
  }).join("");
  const redacted = singleLine
    .replace(/:\/\/[^:@/\s]+:[^@/\s]+@/g, "://[redacted]@")
    .replace(/\b(authorization\s*[:=]\s*Bearer\s+)[^\s,;]+/gi, "$1[redacted]")
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/g, "$1[redacted]")
    .replace(
      /\b((?:app[_-]?secret|tenant[_-]?access[_-]?token|access[_-]?token|refresh[_-]?token|token|secret|password)\s*[:=]\s*)[^\s&;,]+/gi,
      "$1[redacted]",
    )
    .replace(/\s+/g, " ")
    .trim();

  if (!redacted) {
    return "unknown error";
  }
  if (redacted.length <= FEISHU_WS_LOG_ERROR_MAX_LENGTH) {
    return redacted;
  }
  return `${redacted.slice(0, FEISHU_WS_LOG_ERROR_MAX_LENGTH)}...`;
}

type FeishuWsReconnectInfo = ReturnType<Lark.WSClient["getReconnectInfo"]>;
type FeishuWsLifecycleSignal = { type: "sdk-error"; error: unknown };
type FeishuWsSupervisorSignal =
  | FeishuWsLifecycleSignal
  | { type: "abort" }
  | { type: "reconnect-stalled"; reconnectInfo: FeishuWsReconnectInfo };

function createFeishuWsLifecycleMonitor(): {
  callbacks: FeishuWSClientLifecycleCallbacks;
  signal: Promise<FeishuWsLifecycleSignal>;
  hasConnected: () => boolean;
  isReconnecting: () => boolean;
} {
  let hasConnected = false;
  let reconnecting = false;
  let settled = false;
  let resolveSignal: (signal: FeishuWsLifecycleSignal) => void = () => {};
  const signal = new Promise<FeishuWsLifecycleSignal>((resolve) => {
    resolveSignal = resolve;
  });
  const resolveOnce = (value: FeishuWsLifecycleSignal): void => {
    if (settled) {
      return;
    }
    settled = true;
    resolveSignal(value);
  };

  return {
    callbacks: {
      onReady: () => {
        hasConnected = true;
        reconnecting = false;
      },
      onReconnecting: () => {
        reconnecting = true;
      },
      onReconnected: () => {
        hasConnected = true;
        reconnecting = false;
      },
      onError: (err) => {
        resolveOnce({ type: "sdk-error", error: err });
      },
    },
    signal,
    hasConnected: () => hasConnected,
    isReconnecting: () => reconnecting,
  };
}

function getFeishuWsStalledReconnectInfo(
  wsClient: Lark.WSClient,
  nowMs: number,
): FeishuWsReconnectInfo | null {
  const reconnectInfo = wsClient.getReconnectInfo();
  const nextConnectTime = reconnectInfo.nextConnectTime;
  if (
    !Number.isFinite(nextConnectTime) ||
    nextConnectTime <= 0 ||
    nowMs - nextConnectTime < FEISHU_WS_RECONNECT_STALL_GRACE_MS
  ) {
    return null;
  }
  return reconnectInfo;
}

function formatFeishuWsReconnectInfo(info: FeishuWsReconnectInfo): string {
  return `lastConnectTime=${Math.max(0, Math.floor(info.lastConnectTime))} nextConnectTime=${Math.max(0, Math.floor(info.nextConnectTime))}`;
}

function formatFeishuWsSupervisorSignal(
  signal: Exclude<FeishuWsSupervisorSignal, { type: "abort" }>,
): string {
  if (signal.type === "sdk-error") {
    return `SDK retry exhaustion: ${formatFeishuWsErrorForLog(signal.error)}`;
  }
  return `reconnect state stalled (${formatFeishuWsReconnectInfo(signal.reconnectInfo)})`;
}

function waitForFeishuWsSupervisorSignal(params: {
  wsClient: Lark.WSClient;
  lifecycleSignal: Promise<FeishuWsLifecycleSignal>;
  isReconnecting: () => boolean;
  abortSignal?: AbortSignal;
}): Promise<FeishuWsSupervisorSignal> {
  const { wsClient, lifecycleSignal, isReconnecting, abortSignal } = params;
  if (abortSignal?.aborted) {
    return Promise.resolve({ type: "abort" });
  }

  return new Promise((resolve) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const settle = (signal: FeishuWsSupervisorSignal): void => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      abortSignal?.removeEventListener("abort", handleAbort);
      resolve(signal);
    };
    const handleAbort = () => {
      settle({ type: "abort" });
    };
    const poll = () => {
      if (abortSignal?.aborted) {
        handleAbort();
        return;
      }
      if (isReconnecting()) {
        const reconnectInfo = getFeishuWsStalledReconnectInfo(wsClient, Date.now());
        if (reconnectInfo) {
          settle({ type: "reconnect-stalled", reconnectInfo });
          return;
        }
      }
      timer = setTimeout(poll, FEISHU_WS_SUPERVISOR_POLL_MS);
    };

    abortSignal?.addEventListener("abort", handleAbort, { once: true });
    void lifecycleSignal.then(settle);
    poll();
  });
}

function cleanupFeishuWsClient(params: {
  accountId: string;
  wsClient?: Lark.WSClient;
  error: (message: string) => void;
  preserveBotIdentity?: boolean;
}): void {
  const { accountId, wsClient, error, preserveBotIdentity = false } = params;
  if (wsClient) {
    try {
      wsClient.close();
    } catch (err) {
      error(
        `feishu[${accountId}]: error closing WebSocket client: ${formatFeishuWsErrorForLog(err)}`,
      );
    }
  }
  wsClients.delete(accountId);
  if (!preserveBotIdentity) {
    botOpenIds.delete(accountId);
    botNames.delete(accountId);
  }
}

export async function monitorWebSocket({
  account,
  accountId,
  runtime,
  abortSignal,
  eventDispatcher,
}: MonitorTransportParams): Promise<void> {
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;

  let attempt = 0;
  while (true) {
    if (abortSignal?.aborted) {
      break;
    }

    let wsClient: Lark.WSClient | undefined;
    const lifecycle = createFeishuWsLifecycleMonitor();
    try {
      log(`feishu[${accountId}]: starting WebSocket connection...`);
      wsClient = await createFeishuWSClient(account, lifecycle.callbacks);
      if (abortSignal?.aborted) {
        cleanupFeishuWsClient({ accountId, wsClient, error });
        break;
      }
      wsClients.set(accountId, wsClient);
      await wsClient.start({ eventDispatcher });
      log(`feishu[${accountId}]: WebSocket client started`);
      const supervisorSignal = await waitForFeishuWsSupervisorSignal({
        wsClient,
        lifecycleSignal: lifecycle.signal,
        isReconnecting: lifecycle.isReconnecting,
        abortSignal,
      });
      if (supervisorSignal.type === "abort") {
        log(`feishu[${accountId}]: abort signal received, stopping`);
        cleanupFeishuWsClient({ accountId, wsClient, error });
        return;
      }

      cleanupFeishuWsClient({ accountId, wsClient, error, preserveBotIdentity: true });
      if (lifecycle.hasConnected()) {
        attempt = 0;
      }
      attempt += 1;
      const delayMs = getFeishuWsReconnectDelayMs(attempt);
      error(
        `feishu[${accountId}]: WebSocket supervisor detected ${formatFeishuWsSupervisorSignal(supervisorSignal)}, recreating client in ${delayMs}ms`,
      );
      const shouldRetry = await waitForAbortableDelay(delayMs, abortSignal);
      if (!shouldRetry) {
        cleanupFeishuWsClient({ accountId, error });
        break;
      }
    } catch (err) {
      cleanupFeishuWsClient({
        accountId,
        wsClient,
        error,
        preserveBotIdentity: !abortSignal?.aborted,
      });
      if (abortSignal?.aborted) {
        break;
      }

      attempt += 1;
      const delayMs = getFeishuWsReconnectDelayMs(attempt);
      error(
        `feishu[${accountId}]: WebSocket start failed, retrying in ${delayMs}ms: ${formatFeishuWsErrorForLog(err)}`,
      );
      const shouldRetry = await waitForAbortableDelay(delayMs, abortSignal);
      if (!shouldRetry) {
        cleanupFeishuWsClient({ accountId, error });
        break;
      }
    }
  }

  if (abortSignal?.aborted) {
    cleanupFeishuWsClient({ accountId, error });
  }
}

export async function monitorWebhook({
  account,
  accountId,
  runtime,
  abortSignal,
  eventDispatcher,
}: MonitorTransportParams): Promise<void> {
  const log = runtime?.log ?? console.log;
  const error = runtime?.error ?? console.error;
  const encryptKey = account.encryptKey?.trim();
  if (!encryptKey) {
    throw new Error(`Feishu account "${accountId}" webhook mode requires encryptKey`);
  }

  const port = account.config.webhookPort ?? 3000;
  const path = account.config.webhookPath ?? "/feishu/events";
  const host = account.config.webhookHost ?? "127.0.0.1";

  log(`feishu[${accountId}]: starting Webhook server on ${host}:${port}, path ${path}...`);

  const server = http.createServer();

  server.on("request", (req, res) => {
    res.on("finish", () => {
      recordWebhookStatus(runtime, accountId, path, res.statusCode);
    });

    const rateLimitKey = `${accountId}:${path}:${req.socket.remoteAddress ?? "unknown"}`;
    if (
      !applyBasicWebhookRequestGuards({
        req,
        res,
        rateLimiter: feishuWebhookRateLimiter,
        rateLimitKey,
        nowMs: Date.now(),
        requireJsonContentType: true,
      })
    ) {
      return;
    }

    const guard = installRequestBodyLimitGuard(req, res, {
      maxBytes: FEISHU_WEBHOOK_MAX_BODY_BYTES,
      timeoutMs: FEISHU_WEBHOOK_BODY_TIMEOUT_MS,
      responseFormat: "text",
    });
    if (guard.isTripped()) {
      return;
    }

    void (async () => {
      try {
        const body = await readWebhookBodyOrReject({
          req,
          res,
          maxBytes: FEISHU_WEBHOOK_MAX_BODY_BYTES,
          timeoutMs: FEISHU_WEBHOOK_BODY_TIMEOUT_MS,
          profile: "pre-auth",
        });
        if (!body.ok || res.writableEnded) {
          return;
        }
        if (guard.isTripped()) {
          return;
        }
        const rawBody = body.value;

        // Reject invalid signatures before any JSON parsing to keep the auth boundary strict.
        if (
          !isFeishuWebhookSignatureValid({
            headers: req.headers,
            rawBody,
            encryptKey,
          })
        ) {
          respondText(res, 401, "Invalid signature");
          return;
        }

        const payload = parseFeishuWebhookPayload(rawBody);
        if (!payload) {
          respondText(res, 400, "Invalid JSON");
          return;
        }

        const { isChallenge, challenge } = Lark.generateChallenge(payload, {
          encryptKey,
        });
        if (isChallenge) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(challenge));
          return;
        }

        const value = await eventDispatcher.invoke(buildFeishuWebhookEnvelope(req, payload), {
          needCheck: false,
        });
        if (!res.headersSent) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json; charset=utf-8");
          res.end(JSON.stringify(value));
        }
      } catch (err) {
        error(`feishu[${accountId}]: webhook handler error: ${String(err)}`);
        if (!res.headersSent) {
          respondText(res, 500, "Internal Server Error");
        }
      } finally {
        guard.dispose();
      }
    })();
  });

  httpServers.set(accountId, server);

  return new Promise((resolve, reject) => {
    const cleanup = () => {
      server.close();
      httpServers.delete(accountId);
      botOpenIds.delete(accountId);
      botNames.delete(accountId);
    };

    const handleAbort = () => {
      log(`feishu[${accountId}]: abort signal received, stopping Webhook server`);
      cleanup();
      resolve();
    };

    if (abortSignal?.aborted) {
      cleanup();
      resolve();
      return;
    }

    abortSignal?.addEventListener("abort", handleAbort, { once: true });

    server.listen(port, host, () => {
      log(`feishu[${accountId}]: Webhook server listening on ${host}:${port}`);
    });

    server.on("error", (err) => {
      error(`feishu[${accountId}]: Webhook server error: ${err}`);
      abortSignal?.removeEventListener("abort", handleAbort);
      reject(err);
    });
  });
}
