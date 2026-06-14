/**
 * Transcript repair helpers for tool-call replay.
 *
 * Normalizes raw tool-call blocks and synthesizes missing tool results without rewriting trusted local payloads.
 */
import {
  hasNonEmptyString as hasNonEmptyStringField,
  normalizeOptionalString,
  readStringValue,
} from "@openclaw/normalization-core/string-coerce";
import type { AgentMessage } from "./runtime/index.js";
import {
  extractToolCallsFromAssistant,
  extractToolResultId,
  extractToolResultIds,
} from "./tool-call-id.js";
import {
  isAllowedToolCallName,
  normalizeAllowedToolNames,
  normalizeFunctionsToolCallIdPrefix,
  normalizeFunctionsToolNamePrefix,
} from "./tool-call-shared.js";

type RawToolCallBlock = {
  type?: unknown;
  id?: unknown;
  call_id?: unknown;
  toolCallId?: unknown;
  toolUseId?: unknown;
  tool_call_id?: unknown;
  tool_use_id?: unknown;
  name?: unknown;
  input?: unknown;
  arguments?: unknown;
};

const RAW_TOOL_CALL_BLOCK_TYPES = new Set([
  "toolCall",
  "toolUse",
  "functionCall",
  "tool_call",
  "tool_use",
  "function_call",
]);

function isThinkingLikeBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return type === "thinking" || type === "redacted_thinking";
}

function isRawToolCallBlock(block: unknown): block is RawToolCallBlock {
  if (!block || typeof block !== "object") {
    return false;
  }
  const type = (block as { type?: unknown }).type;
  return typeof type === "string" && RAW_TOOL_CALL_BLOCK_TYPES.has(type);
}

function hasToolCallInput(block: RawToolCallBlock): boolean {
  const hasInput = "input" in block ? block.input !== undefined && block.input !== null : false;
  const hasArguments =
    "arguments" in block ? block.arguments !== undefined && block.arguments !== null : false;
  return hasInput || hasArguments;
}

function hasToolCallId(block: RawToolCallBlock): boolean {
  return (
    hasNonEmptyStringField(block.id) ||
    hasNonEmptyStringField(block.call_id) ||
    hasNonEmptyStringField(block.toolCallId) ||
    hasNonEmptyStringField(block.toolUseId) ||
    hasNonEmptyStringField(block.tool_call_id) ||
    hasNonEmptyStringField(block.tool_use_id)
  );
}

function toolCallIdKey(id: string): string {
  return normalizeFunctionsToolCallIdPrefix(id);
}

function extractToolResultIdKey(msg: Extract<AgentMessage, { role: "toolResult" }>): string | null {
  const id = extractToolResultId(msg);
  return id ? toolCallIdKey(id) : null;
}

function extractToolResultIdKeys(msg: Extract<AgentMessage, { role: "toolResult" }>): string[] {
  const ids: string[] = [];
  for (const id of extractToolResultIds(msg)) {
    const key = toolCallIdKey(id);
    if (key && !ids.includes(key)) {
      ids.push(key);
    }
  }
  return ids;
}

function normalizeTranscriptToolName(
  name: unknown,
  allowedToolNames: Set<string> | null,
  options?: { preserveFunctionsPrefix?: boolean },
): string | undefined {
  const rawName = readStringValue(name);
  const trimmedName = rawName?.trim();
  if (!trimmedName) {
    return undefined;
  }
  if (options?.preserveFunctionsPrefix !== true) {
    const functionsName = normalizeFunctionsToolNamePrefix(trimmedName);
    if (functionsName && isAllowedToolCallName(functionsName, allowedToolNames)) {
      return functionsName;
    }
  }
  return trimmedName;
}

function sanitizeToolCallBlock(
  block: RawToolCallBlock,
  allowedToolNames: Set<string> | null,
  options?: { preserveFunctionsPrefix?: boolean },
): RawToolCallBlock {
  // This repair path normalizes replay shape only. Tool payloads are local
  // trusted-operator transcript state per SECURITY.md, so do not redact or
  // rewrite sessions_spawn arguments here.
  const rawName = readStringValue(block.name);
  const normalizedName = normalizeTranscriptToolName(block.name, allowedToolNames, options);
  const nameChanged = Boolean(normalizedName) && rawName !== normalizedName;

  if (!nameChanged) {
    return block;
  }
  const next = { ...(block as Record<string, unknown>) };
  if (nameChanged && normalizedName) {
    next.name = normalizedName;
  }
  return next as RawToolCallBlock;
}

function countRawToolCallBlocks(content: unknown[]): number {
  let count = 0;
  for (const block of content) {
    if (isRawToolCallBlock(block)) {
      count += 1;
    }
  }
  return count;
}

function isReplaySafeThinkingAssistantTurn(
  content: unknown[],
  allowedToolNames: Set<string> | null,
): boolean {
  let sawToolCall = false;
  const seenToolCallIds = new Set<string>();
  for (const block of content) {
    if (!isRawToolCallBlock(block)) {
      continue;
    }
    sawToolCall = true;
    const toolCallId = typeof block.id === "string" ? toolCallIdKey(block.id.trim()) : "";
    if (
      !hasToolCallInput(block) ||
      !toolCallId ||
      seenToolCallIds.has(toolCallId) ||
      !isAllowedToolCallName(block.name, allowedToolNames)
    ) {
      return false;
    }
    seenToolCallIds.add(toolCallId);
    if (
      sanitizeToolCallBlock(block, allowedToolNames, { preserveFunctionsPrefix: true }) !== block
    ) {
      return false;
    }
  }
  return sawToolCall;
}

function hasAttachmentPayload(value: unknown): boolean {
  if (!value || typeof value !== "object") {
    return false;
  }
  const attachments = (value as { attachments?: unknown }).attachments;
  return Array.isArray(attachments) && attachments.length > 0;
}

function hasSessionsSpawnAttachmentToolCall(content: unknown[]): boolean {
  for (const block of content) {
    if (!isRawToolCallBlock(block)) {
      continue;
    }
    const name = normalizeTranscriptToolName(block.name, null, {
      preserveFunctionsPrefix: false,
    });
    if (name?.toLowerCase() !== "sessions_spawn") {
      continue;
    }
    if (hasAttachmentPayload(block.input) || hasAttachmentPayload(block.arguments)) {
      return true;
    }
  }
  return false;
}

const DEFAULT_MISSING_TOOL_RESULT_TEXT =
  "[openclaw] missing tool result in session history; inserted synthetic error result for transcript repair.";
const SYNTHETIC_MISSING_TOOL_RESULT_DETAIL_KEY = "openclawSyntheticMissingToolResult";

function makeMissingToolResult(params: {
  toolCallId: string;
  toolName?: string;
  // OpenAI Responses/Codex replay should match upstream Codex's "aborted"
  // function_call_output normalization; live coverage in
  // openai-reasoning-compat.live.test.ts and tool-replay-repair.live.test.ts
  // sends this repaired history to real models. Other providers keep the older,
  // explicit OpenClaw diagnostic text unless the caller opts in.
  text?: string;
}): Extract<AgentMessage, { role: "toolResult" }> {
  return {
    role: "toolResult",
    toolCallId: params.toolCallId,
    toolName: params.toolName ?? "unknown",
    content: [
      {
        type: "text",
        text: params.text ?? DEFAULT_MISSING_TOOL_RESULT_TEXT,
      },
    ],
    details: { [SYNTHETIC_MISSING_TOOL_RESULT_DETAIL_KEY]: true },
    isError: true,
    timestamp: Date.now(),
  } as Extract<AgentMessage, { role: "toolResult" }>;
}

function isSyntheticMissingToolResult(msg: Extract<AgentMessage, { role: "toolResult" }>): boolean {
  if (!(msg as { isError?: unknown }).isError) {
    return false;
  }
  const details = (msg as { details?: unknown }).details;
  if (
    details &&
    typeof details === "object" &&
    (details as Record<string, unknown>)[SYNTHETIC_MISSING_TOOL_RESULT_DETAIL_KEY] === true
  ) {
    return true;
  }
  const content = (msg as { content?: unknown }).content;
  if (!Array.isArray(content)) {
    return false;
  }
  return content.some(
    (block: unknown) =>
      typeof block === "object" &&
      block !== null &&
      (block as { type?: string }).type === "text" &&
      (block as { text?: string }).text === DEFAULT_MISSING_TOOL_RESULT_TEXT,
  );
}

function normalizeToolResultName(
  message: Extract<AgentMessage, { role: "toolResult" }>,
  fallbackName?: string,
): Extract<AgentMessage, { role: "toolResult" }> {
  const rawToolName = (message as { toolName?: unknown }).toolName;
  const normalizedToolName =
    normalizeTranscriptToolName(rawToolName, null) ?? normalizeOptionalString(rawToolName);
  if (normalizedToolName) {
    if (rawToolName === normalizedToolName) {
      return message;
    }
    return { ...message, toolName: normalizedToolName };
  }

  const normalizedFallback =
    normalizeTranscriptToolName(fallbackName, null) ?? normalizeOptionalString(fallbackName);
  if (normalizedFallback) {
    return { ...message, toolName: normalizedFallback };
  }

  if (typeof rawToolName === "string") {
    return { ...message, toolName: "unknown" };
  }
  return message;
}

function normalizeLegacyToolResultId(
  message: Extract<AgentMessage, { role: "toolResult" }>,
  toolCalls: Array<{ id: string; name?: string }>,
): Extract<AgentMessage, { role: "toolResult" }> {
  if (extractToolResultId(message) || toolCalls.length !== 1) {
    return message;
  }
  const [toolCall] = toolCalls;
  const toolResultName =
    normalizeTranscriptToolName((message as { toolName?: unknown }).toolName, null) ??
    normalizeOptionalString((message as { toolName?: unknown }).toolName);
  const toolCallName =
    normalizeTranscriptToolName(toolCall.name, null) ?? normalizeOptionalString(toolCall.name);
  if (toolResultName && toolCallName && toolResultName !== toolCallName) {
    return message;
  }
  return { ...message, toolCallId: toolCall.id, isError: true };
}

export { DEFAULT_MISSING_TOOL_RESULT_TEXT, makeMissingToolResult };

type ToolCallInputRepairReport = {
  messages: AgentMessage[];
  droppedToolCalls: number;
  droppedAssistantMessages: number;
};

type ToolCallInputRepairOptions = {
  allowedToolNames?: Iterable<string>;
  allowProviderOwnedThinkingReplay?: boolean;
};

type ErroredAssistantResultPolicy = "preserve" | "drop";

type ToolUseResultPairingOptions = {
  erroredAssistantResultPolicy?: ErroredAssistantResultPolicy;
  missingToolResultText?: string;
};

export function stripToolResultDetails(messages: AgentMessage[]): AgentMessage[] {
  let touched = false;
  const out: AgentMessage[] = [];
  for (const msg of messages) {
    if (!msg || typeof msg !== "object" || (msg as { role?: unknown }).role !== "toolResult") {
      out.push(msg);
      continue;
    }
    if (!("details" in msg)) {
      out.push(msg);
      continue;
    }
    const sanitized = { ...(msg as object) } as { details?: unknown };
    delete sanitized.details;
    touched = true;
    out.push(sanitized as unknown as AgentMessage);
  }
  return touched ? out : messages;
}

function collectFollowingToolResults(
  messages: AgentMessage[],
  index: number,
): { ids: Set<string>; displaced: boolean } {
  const ids = new Set<string>();
  const assistant = messages[index];
  const currentToolCalls =
    assistant && typeof assistant === "object" && assistant.role === "assistant"
      ? extractToolCallsFromAssistant(assistant)
      : [];
  let sawNonToolResult = false;
  let displaced = false;
  for (let nextIndex = index + 1; nextIndex < messages.length; nextIndex += 1) {
    const message = messages[nextIndex];
    if (!message || typeof message !== "object") {
      sawNonToolResult = true;
      continue;
    }
    if (message.role === "assistant" && assistantHasToolCalls(message)) {
      break;
    }
    if (message.role === "toolResult") {
      const normalizedLegacyResult = normalizeLegacyToolResultId(message, currentToolCalls);
      const resultIdKeys = extractToolResultIdKeys(normalizedLegacyResult);
      for (const id of resultIdKeys) {
        ids.add(id);
      }
      displaced ||= resultIdKeys.length > 0 && sawNonToolResult;
      continue;
    }
    sawNonToolResult = true;
  }
  return { ids, displaced };
}

function repairToolCallInputs(
  messages: AgentMessage[],
  options?: ToolCallInputRepairOptions,
): ToolCallInputRepairReport {
  let droppedToolCalls = 0;
  let droppedAssistantMessages = 0;
  let changed = false;
  const out: AgentMessage[] = [];
  const allowedToolNames = normalizeAllowedToolNames(options?.allowedToolNames);
  const allowProviderOwnedThinkingReplay = options?.allowProviderOwnedThinkingReplay === true;
  const preservedThinkingToolCallIds = new Set<string>();
  const priorToolCallIds = new Set<string>();

  for (let index = 0; index < messages.length; index += 1) {
    const msg = messages[index];
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    if (msg.role !== "assistant" || !Array.isArray(msg.content)) {
      out.push(msg);
      continue;
    }

    if (
      allowProviderOwnedThinkingReplay &&
      msg.content.some((block) => isThinkingLikeBlock(block)) &&
      countRawToolCallBlocks(msg.content) > 0
    ) {
      // Signed Anthropic thinking blocks must remain byte-for-byte stable on
      // replay. Preserve the turn when every sibling tool call is already valid;
      // the later pairing repair can synthesize missing legacy tool results
      // without mutating provider-owned assistant content.
      const replaySafeToolCalls = extractToolCallsFromAssistant(msg);
      const followingToolResults = collectFollowingToolResults(messages, index);
      if (
        isReplaySafeThinkingAssistantTurn(msg.content, allowedToolNames) &&
        replaySafeToolCalls.every(
          (toolCall) =>
            !preservedThinkingToolCallIds.has(toolCallIdKey(toolCall.id)) &&
            (!hasSessionsSpawnAttachmentToolCall(msg.content) ||
              followingToolResults.ids.has(toolCallIdKey(toolCall.id))) &&
            (!followingToolResults.displaced || !priorToolCallIds.has(toolCallIdKey(toolCall.id))),
        )
      ) {
        for (const toolCall of replaySafeToolCalls) {
          preservedThinkingToolCallIds.add(toolCallIdKey(toolCall.id));
          priorToolCallIds.add(toolCallIdKey(toolCall.id));
        }
        changed ||= followingToolResults.displaced;
        out.push(msg);
      } else {
        droppedToolCalls += countRawToolCallBlocks(msg.content);
        droppedAssistantMessages += 1;
        changed = true;
      }
      continue;
    }

    const nextContent: typeof msg.content = [];
    let droppedInMessage = 0;
    let messageChanged = false;

    for (const block of msg.content) {
      if (
        isRawToolCallBlock(block) &&
        (!hasToolCallInput(block) ||
          !hasToolCallId(block) ||
          !isAllowedToolCallName((block as RawToolCallBlock).name, allowedToolNames))
      ) {
        droppedToolCalls += 1;
        droppedInMessage += 1;
        changed = true;
        messageChanged = true;
        continue;
      }
      if (isRawToolCallBlock(block)) {
        if (RAW_TOOL_CALL_BLOCK_TYPES.has((block as { type?: string }).type ?? "")) {
          const sanitized = sanitizeToolCallBlock(block, allowedToolNames);
          if (sanitized !== block) {
            changed = true;
            messageChanged = true;
          }
          nextContent.push(sanitized as typeof block);
          continue;
        }
      } else {
        nextContent.push(block);
      }
    }

    if (droppedInMessage > 0) {
      if (nextContent.length === 0) {
        droppedAssistantMessages += 1;
        changed = true;
        continue;
      }
      const nextMessage = { ...msg, content: nextContent };
      for (const toolCall of extractToolCallsFromAssistant(nextMessage)) {
        priorToolCallIds.add(toolCallIdKey(toolCall.id));
      }
      out.push(nextMessage);
      continue;
    }

    if (messageChanged) {
      const nextMessage = { ...msg, content: nextContent };
      for (const toolCall of extractToolCallsFromAssistant(nextMessage)) {
        priorToolCallIds.add(toolCallIdKey(toolCall.id));
      }
      out.push(nextMessage);
      continue;
    }

    for (const toolCall of extractToolCallsFromAssistant(msg)) {
      priorToolCallIds.add(toolCallIdKey(toolCall.id));
    }
    out.push(msg);
  }

  return {
    messages: changed ? out : messages,
    droppedToolCalls,
    droppedAssistantMessages,
  };
}

export function sanitizeToolCallInputs(
  messages: AgentMessage[],
  options?: ToolCallInputRepairOptions,
): AgentMessage[] {
  return repairToolCallInputs(messages, options).messages;
}

export function sanitizeToolUseResultPairing(
  messages: AgentMessage[],
  options?: ToolUseResultPairingOptions,
): AgentMessage[] {
  return repairToolUseResultPairing(messages, options).messages;
}

type ToolUseRepairReport = {
  messages: AgentMessage[];
  added: Array<Extract<AgentMessage, { role: "toolResult" }>>;
  droppedDuplicateCount: number;
  droppedOrphanCount: number;
  moved: boolean;
};

function shouldDropErroredAssistantResults(options?: ToolUseResultPairingOptions): boolean {
  return options?.erroredAssistantResultPolicy === "drop";
}

function assistantHasToolCalls(message: AgentMessage): boolean {
  if (!message || typeof message !== "object" || message.role !== "assistant") {
    return false;
  }
  return extractToolCallsFromAssistant(message).length > 0;
}

function findLaterMatchingToolResult(params: {
  messages: AgentMessage[];
  startIndex: number;
  toolCallIdKey: string;
  toolName?: string;
  toolCalls: Array<{ id: string; name?: string }>;
  seenToolResultIds: Set<string>;
}): Extract<AgentMessage, { role: "toolResult" }> | undefined {
  for (let index = params.startIndex; index < params.messages.length; index += 1) {
    const candidate = params.messages[index];
    if (!candidate || typeof candidate !== "object" || candidate.role !== "toolResult") {
      continue;
    }
    const normalizedLegacyResult = normalizeLegacyToolResultId(candidate, params.toolCalls);
    const id = extractToolResultIdKey(normalizedLegacyResult);
    if (!id || id !== params.toolCallIdKey || params.seenToolResultIds.has(id)) {
      continue;
    }
    return normalizeToolResultName(normalizedLegacyResult, params.toolName);
  }
  return undefined;
}

export function repairToolUseResultPairing(
  messages: AgentMessage[],
  options?: ToolUseResultPairingOptions,
): ToolUseRepairReport {
  // Anthropic (and Cloud Code Assist) reject transcripts where assistant tool calls are not
  // immediately followed by matching tool results. Session files can end up with results
  // displaced (e.g. after user turns) or duplicated. Repair by:
  // - moving matching toolResult messages directly after their assistant toolCall turn
  // - inserting synthetic error toolResults for missing ids
  // - dropping duplicate toolResults for the same id (anywhere in the transcript)
  const out: AgentMessage[] = [];
  const added: Array<Extract<AgentMessage, { role: "toolResult" }>> = [];
  const seenToolResultIds = new Set<string>();
  const toolResultPositions = new Map<string, number>();
  let droppedDuplicateCount = 0;
  let droppedOrphanCount = 0;
  let moved = false;
  let changed = false;

  const pushToolResult = (msg: Extract<AgentMessage, { role: "toolResult" }>) => {
    const id = extractToolResultIdKey(msg);
    if (id && seenToolResultIds.has(id)) {
      const existingIdx = toolResultPositions.get(id);
      if (existingIdx !== undefined) {
        const existing = out[existingIdx];
        if (
          existing &&
          isSyntheticMissingToolResult(existing as Extract<AgentMessage, { role: "toolResult" }>) &&
          !isSyntheticMissingToolResult(msg)
        ) {
          out[existingIdx] = msg;
          const addedIdx = added.findIndex((a) => extractToolResultIdKey(a) === id);
          if (addedIdx !== -1) {
            added.splice(addedIdx, 1);
          }
          droppedDuplicateCount += 1;
          changed = true;
          return;
        }
      }
      droppedDuplicateCount += 1;
      changed = true;
      return;
    }
    if (id) {
      seenToolResultIds.add(id);
      toolResultPositions.set(id, out.length);
    }
    out.push(msg);
  };

  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") {
      out.push(msg);
      continue;
    }

    const role = (msg as { role?: unknown }).role;
    if (role !== "assistant") {
      // Tool results must only appear directly after the matching assistant tool call turn.
      // Any "free-floating" toolResult entries in session history can make strict providers
      // (Anthropic-compatible APIs, MiniMax, Cloud Code Assist) reject the entire request.
      if (role !== "toolResult") {
        out.push(msg);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
      continue;
    }

    const assistant = msg as Extract<AgentMessage, { role: "assistant" }>;

    const toolCalls = extractToolCallsFromAssistant(assistant);
    if (toolCalls.length === 0) {
      out.push(msg);
      continue;
    }

    const toolCallIds = new Set<string>();
    const toolCallNamesById = new Map<string, string>();
    for (const toolCall of toolCalls) {
      const key = toolCallIdKey(toolCall.id);
      toolCallIds.add(key);
      if (typeof toolCall.name === "string") {
        toolCallNamesById.set(
          key,
          normalizeTranscriptToolName(toolCall.name, null) ?? toolCall.name,
        );
      }
    }

    const spanResultsById = new Map<string, Extract<AgentMessage, { role: "toolResult" }>>();
    const remainder: AgentMessage[] = [];

    let j = i + 1;
    for (; j < messages.length; j += 1) {
      const next = messages[j];
      if (!next || typeof next !== "object") {
        remainder.push(next);
        continue;
      }

      const nextRole = (next as { role?: unknown }).role;
      if (nextRole === "assistant") {
        if (assistantHasToolCalls(next)) {
          break;
        }
        remainder.push(next);
        continue;
      }

      if (nextRole === "toolResult") {
        const toolResult = normalizeLegacyToolResultId(
          next as Extract<AgentMessage, { role: "toolResult" }>,
          toolCalls,
        );
        const id = extractToolResultIdKey(toolResult);
        if (id && seenToolResultIds.has(id)) {
          pushToolResult(normalizeToolResultName(toolResult, toolCallNamesById.get(id)));
          continue;
        }
        if (id && toolCallIds.has(id)) {
          if (toolResult !== next) {
            changed = true;
          }
          const normalizedToolResult = normalizeToolResultName(
            toolResult,
            toolCallNamesById.get(id),
          );
          if (normalizedToolResult !== toolResult) {
            changed = true;
          }
          const existingSpan = spanResultsById.get(id);
          if (!existingSpan) {
            spanResultsById.set(id, normalizedToolResult);
          } else if (
            isSyntheticMissingToolResult(existingSpan) &&
            !isSyntheticMissingToolResult(normalizedToolResult)
          ) {
            spanResultsById.set(id, normalizedToolResult);
            droppedDuplicateCount += 1;
            changed = true;
          } else {
            droppedDuplicateCount += 1;
            changed = true;
          }
          continue;
        }
      }

      // Drop tool results that don't match the current assistant tool calls.
      if (nextRole !== "toolResult") {
        remainder.push(next);
      } else {
        droppedOrphanCount += 1;
        changed = true;
      }
    }

    // Aborted/errored assistant turns should never synthesize missing tool results, but
    // the replay sanitizer can still legitimately retain real tool results for surviving
    // tool calls in the same turn after malformed siblings are dropped.
    const stopReason = (assistant as { stopReason?: string }).stopReason;
    if (stopReason === "error" || stopReason === "aborted") {
      if (!shouldDropErroredAssistantResults(options)) {
        out.push(msg);
        for (const toolCall of toolCalls) {
          const result = spanResultsById.get(toolCallIdKey(toolCall.id));
          if (!result) {
            continue;
          }
          pushToolResult(result);
        }
      } else if (spanResultsById.size > 0) {
        changed = true;
      } else {
        changed = true;
      }
      for (const rem of remainder) {
        out.push(rem);
      }
      i = j - 1;
      continue;
    }

    out.push(msg);

    if (spanResultsById.size > 0 && remainder.length > 0) {
      // Preserve real late-arriving results before synthesizing missing siblings;
      // otherwise parallel tool replay can replace useful output with repair noise.
      moved = true;
      changed = true;
    }

    for (const call of toolCalls) {
      const callKey = toolCallIdKey(call.id);
      const existing = spanResultsById.get(callKey);
      if (existing) {
        pushToolResult(existing);
      } else {
        const laterResult = findLaterMatchingToolResult({
          messages,
          startIndex: j,
          toolCallIdKey: callKey,
          toolName: toolCallNamesById.get(callKey) ?? call.name,
          toolCalls,
          seenToolResultIds,
        });
        if (laterResult) {
          moved = true;
          changed = true;
          pushToolResult(laterResult);
        } else {
          const missing = makeMissingToolResult({
            toolCallId: call.id,
            toolName: toolCallNamesById.get(callKey) ?? call.name,
            text: options?.missingToolResultText,
          });
          added.push(missing);
          changed = true;
          pushToolResult(missing);
        }
      }
    }

    for (const rem of remainder) {
      if (!rem || typeof rem !== "object") {
        out.push(rem);
        continue;
      }
      out.push(rem);
    }
    i = j - 1;
  }

  const changedOrMoved = changed || moved;
  return {
    messages: changedOrMoved ? out : messages,
    added,
    droppedDuplicateCount,
    droppedOrphanCount,
    moved: changedOrMoved,
  };
}
