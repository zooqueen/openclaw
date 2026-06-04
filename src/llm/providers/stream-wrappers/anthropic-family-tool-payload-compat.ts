import { normalizeOptionalString } from "@openclaw/normalization-core/string-coerce";
import type { StreamFn } from "../../../agents/runtime/index.js";
import { streamSimple } from "../../stream.js";
type AnthropicToolSchemaMode = "openai-functions";
type AnthropicToolChoiceMode = "openai-string-modes";

type AnthropicToolPayloadCompatibilityOptions = {
  toolSchemaMode?: AnthropicToolSchemaMode;
  toolChoiceMode?: AnthropicToolChoiceMode;
};
type PayloadFieldRead = { ok: true; value: unknown } | { ok: false };

function hasOpenAiAnthropicToolPayloadCompatFlag(model: { compat?: unknown }): boolean {
  if (!model.compat || typeof model.compat !== "object" || Array.isArray(model.compat)) {
    return false;
  }

  return (
    (model.compat as { requiresOpenAiAnthropicToolPayload?: unknown })
      .requiresOpenAiAnthropicToolPayload === true
  );
}

function requiresAnthropicToolPayloadCompatibilityForModel(
  model: {
    api?: unknown;
    compat?: unknown;
  },
  options?: AnthropicToolPayloadCompatibilityOptions,
): boolean {
  if (model.api !== "anthropic-messages") {
    return false;
  }
  return (
    Boolean(options?.toolSchemaMode || options?.toolChoiceMode) ||
    hasOpenAiAnthropicToolPayloadCompatFlag(model)
  );
}

function usesOpenAiFunctionAnthropicToolSchemaForModel(
  model: {
    compat?: unknown;
  },
  options?: AnthropicToolPayloadCompatibilityOptions,
): boolean {
  return (
    options?.toolSchemaMode === "openai-functions" || hasOpenAiAnthropicToolPayloadCompatFlag(model)
  );
}

function usesOpenAiStringModeAnthropicToolChoiceForModel(
  model: {
    compat?: unknown;
  },
  options?: AnthropicToolPayloadCompatibilityOptions,
): boolean {
  return (
    options?.toolChoiceMode === "openai-string-modes" ||
    hasOpenAiAnthropicToolPayloadCompatFlag(model)
  );
}

function normalizeOpenAiFunctionAnthropicToolDefinition(
  tool: unknown,
): Record<string, unknown> | undefined {
  if (!tool || typeof tool !== "object" || Array.isArray(tool)) {
    return undefined;
  }

  const toolObj = tool as Record<string, unknown>;
  const functionField = readPayloadField(toolObj, "function");
  if (!functionField.ok) {
    return undefined;
  }
  if (functionField.value && typeof functionField.value === "object") {
    return toolObj;
  }

  const nameField = readPayloadField(toolObj, "name");
  if (!nameField.ok) {
    return undefined;
  }
  const rawName = normalizeOptionalString(nameField.value) ?? "";
  if (!rawName) {
    return toolObj;
  }

  const inputSchemaField = readPayloadField(toolObj, "input_schema");
  if (!inputSchemaField.ok) {
    return undefined;
  }
  const inputSchema = inputSchemaField.value;
  let parameters: unknown = { type: "object", properties: {} };
  if (inputSchema && typeof inputSchema === "object") {
    parameters = inputSchema;
  } else {
    const parametersField = readPayloadField(toolObj, "parameters");
    if (!parametersField.ok) {
      return undefined;
    }
    if (parametersField.value && typeof parametersField.value === "object") {
      parameters = parametersField.value;
    }
  }
  const functionSpec: Record<string, unknown> = {
    name: rawName,
    parameters,
  };

  const descriptionField = readPayloadField(toolObj, "description");
  if (
    descriptionField.ok &&
    typeof descriptionField.value === "string" &&
    descriptionField.value.trim()
  ) {
    functionSpec.description = descriptionField.value;
  }
  const strictField = readPayloadField(toolObj, "strict");
  if (strictField.ok && typeof strictField.value === "boolean") {
    functionSpec.strict = strictField.value;
  }

  return {
    type: "function",
    function: functionSpec,
  };
}

function readPayloadField(record: Record<string, unknown>, field: string): PayloadFieldRead {
  try {
    return { ok: true, value: Reflect.get(record, field) };
  } catch {
    return { ok: false };
  }
}

function normalizeOpenAiStringModeAnthropicToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice !== "object" || Array.isArray(toolChoice)) {
    return toolChoice;
  }

  const choice = toolChoice as Record<string, unknown>;
  if (choice.type === "auto") {
    return "auto";
  }
  if (choice.type === "none") {
    return "none";
  }
  if (choice.type === "required" || choice.type === "any") {
    return "required";
  }
  if (choice.type === "tool" && typeof choice.name === "string" && choice.name.trim()) {
    return {
      type: "function",
      function: { name: choice.name.trim() },
    };
  }

  return toolChoice;
}

/** @deprecated Anthropic-family provider stream helper; do not use from third-party plugins. */
export function createAnthropicToolPayloadCompatibilityWrapper(
  baseStreamFn: StreamFn | undefined,
  options?: AnthropicToolPayloadCompatibilityOptions,
): StreamFn {
  const underlying = baseStreamFn ?? streamSimple;
  return (model, context, streamOptions) => {
    const originalOnPayload = streamOptions?.onPayload;
    return underlying(model, context, {
      ...streamOptions,
      onPayload: (payload) => {
        if (
          payload &&
          typeof payload === "object" &&
          requiresAnthropicToolPayloadCompatibilityForModel(model, options)
        ) {
          const payloadObj = payload as Record<string, unknown>;
          if (
            Array.isArray(payloadObj.tools) &&
            usesOpenAiFunctionAnthropicToolSchemaForModel(model, options)
          ) {
            payloadObj.tools = payloadObj.tools
              .map((tool) => normalizeOpenAiFunctionAnthropicToolDefinition(tool))
              .filter((tool): tool is Record<string, unknown> => Boolean(tool));
          }
          if (usesOpenAiStringModeAnthropicToolChoiceForModel(model, options)) {
            payloadObj.tool_choice = normalizeOpenAiStringModeAnthropicToolChoice(
              payloadObj.tool_choice,
            );
          }
        }
        return originalOnPayload?.(payload, model);
      },
    });
  };
}

/** @deprecated Anthropic-family provider stream helper; do not use from third-party plugins. */
export function createOpenAIAnthropicToolPayloadCompatibilityWrapper(
  baseStreamFn: StreamFn | undefined,
): StreamFn {
  return createAnthropicToolPayloadCompatibilityWrapper(baseStreamFn, {
    toolSchemaMode: "openai-functions",
    toolChoiceMode: "openai-string-modes",
  });
}
