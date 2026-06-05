// Venice plugin module implements stream behavior.
import type { ProviderWrapStreamFnContext } from "openclaw/plugin-sdk/plugin-entry";
import { createPayloadPatchStreamWrapper } from "openclaw/plugin-sdk/provider-stream-shared";

function isVeniceDeepSeekV4ModelId(modelId: unknown): boolean {
  return modelId === "deepseek-v4-flash" || modelId === "deepseek-v4-pro";
}

type PayloadFieldRead = { ok: true; value: unknown } | { ok: false };

function readPayloadField(record: Record<string, unknown>, key: string): PayloadFieldRead {
  try {
    return { ok: true, value: record[key] };
  } catch {
    return { ok: false };
  }
}

function deletePayloadField(record: Record<string, unknown>, key: string): boolean {
  try {
    delete record[key];
    return !Object.hasOwn(record, key);
  } catch {
    return false;
  }
}

function forcePayloadField(record: Record<string, unknown>, key: string, value: unknown): boolean {
  try {
    Object.defineProperty(record, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
    const next = readPayloadField(record, key);
    return next.ok && next.value === value;
  } catch {
    return false;
  }
}

function removeVenicePayloadField(payload: Record<string, unknown>, key: string): void {
  if (!deletePayloadField(payload, key)) {
    throw new Error(`Venice payload field could not be removed: ${key}`);
  }
}

function ensureVeniceDeepSeekV4Replay(payload: Record<string, unknown>): void {
  removeVenicePayloadField(payload, "thinking");
  removeVenicePayloadField(payload, "reasoning");
  removeVenicePayloadField(payload, "reasoning_effort");

  const messages = readPayloadField(payload, "messages");
  if (!messages.ok || !Array.isArray(messages.value)) {
    return;
  }
  for (const message of messages.value) {
    if (!message || typeof message !== "object") {
      continue;
    }
    const record = message as Record<string, unknown>;
    const role = readPayloadField(record, "role");
    if (role.ok && role.value === "assistant") {
      const reasoningContent = readPayloadField(record, "reasoning_content");
      if (reasoningContent.ok && typeof reasoningContent.value === "string") {
        continue;
      }
      if (!forcePayloadField(record, "reasoning_content", "")) {
        throw new Error("Venice assistant reasoning_content payload patch failed");
      }
    }
  }
}

export function createVeniceDeepSeekV4Wrapper(
  baseStreamFn: ProviderWrapStreamFnContext["streamFn"],
  thinkingLevel: ProviderWrapStreamFnContext["thinkingLevel"],
): ProviderWrapStreamFnContext["streamFn"] {
  void thinkingLevel;
  return createPayloadPatchStreamWrapper(baseStreamFn, ({ payload, model }) => {
    if (model.provider === "venice" && isVeniceDeepSeekV4ModelId(model.id)) {
      ensureVeniceDeepSeekV4Replay(payload);
    }
  });
}
