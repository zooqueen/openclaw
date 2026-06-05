// Moonshot stream wrapper normalizes Moonshot streamed text and reasoning output.
import type { StreamFn } from "../../../agents/runtime/index.js";
import type { ThinkLevel } from "../../../auto-reply/thinking.js";
import { streamSimple } from "../../stream.js";
import { streamWithPayloadPatch } from "./stream-payload-utils.js";

export {
  createMoonshotThinkingWrapper,
  resolveMoonshotThinkingKeep,
  resolveMoonshotThinkingType,
} from "./moonshot-thinking.js";

/** Detects SiliconFlow Pro models that require thinking=null instead of thinking="off". */
export function shouldApplySiliconFlowThinkingOffCompat(params: {
  provider: string;
  modelId: string;
  thinkingLevel?: ThinkLevel;
}): boolean {
  return (
    params.provider === "siliconflow" &&
    params.thinkingLevel === "off" &&
    params.modelId.startsWith("Pro/")
  );
}

type PayloadFieldRead = { ok: true; value: unknown } | { ok: false };

function readPayloadField(record: Record<string, unknown>, key: string): PayloadFieldRead {
  try {
    return { ok: true, value: record[key] };
  } catch {
    return { ok: false };
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

/** Wraps Moonshot-compatible requests to rewrite SiliconFlow thinking-off payloads. */
export function createSiliconFlowThinkingWrapper(baseStreamFn: StreamFn | undefined): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, options) =>
    streamWithPayloadPatch(underlying, model, context, options, (payloadObj) => {
      // SiliconFlow rejects the string "off" for these models but accepts null.
      const thinking = readPayloadField(payloadObj, "thinking");
      if (!thinking.ok || thinking.value === "off") {
        if (!forcePayloadField(payloadObj, "thinking", null)) {
          throw new Error("SiliconFlow thinking payload patch failed");
        }
      }
    });
}
