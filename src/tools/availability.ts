import type {
  JsonObject,
  JsonPrimitive,
  JsonValue,
  ToolAvailabilityContext,
  ToolAvailabilityDiagnostic,
  ToolAvailabilityExpression,
  ToolAvailabilitySignal,
  ToolDescriptor,
} from "./types.js";

function isRecord(value: JsonValue | undefined): value is JsonObject {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function resolveConfigPath(
  config: JsonObject | undefined,
  path: readonly string[],
): JsonValue | undefined {
  let current: JsonValue | undefined = config;
  for (const segment of path) {
    if (!isRecord(current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function resolveConfigSignalValue(params: {
  config: JsonObject | undefined;
  signal: Extract<ToolAvailabilitySignal, { readonly kind: "config" }>;
}): { value: JsonValue | undefined; matchedPath?: readonly string[] } {
  const paths = params.signal.paths?.length ? params.signal.paths : undefined;
  if (paths) {
    for (const path of paths) {
      const value = resolveConfigPath(params.config, path);
      if (value !== undefined) {
        return { value, matchedPath: path };
      }
    }
    return { value: undefined };
  }
  if (!params.signal.path) {
    return { value: undefined };
  }
  return {
    value: resolveConfigPath(params.config, params.signal.path),
    matchedPath: params.signal.path,
  };
}

function isJsonPrimitive(value: JsonValue | undefined): value is JsonPrimitive {
  return (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function hasConfiguredValue(params: {
  value: JsonValue | undefined;
  matchedPath?: readonly string[];
  signal: Extract<ToolAvailabilitySignal, { readonly kind: "config" }>;
  context: ToolAvailabilityContext;
}): boolean {
  const { signal } = params;
  const value = params.value === undefined ? signal.default : params.value;
  if ("equals" in signal || "notEquals" in signal) {
    if (!isJsonPrimitive(value)) {
      return false;
    }
    if ("equals" in signal && value !== signal.equals) {
      return false;
    }
    if ("notEquals" in signal && value === signal.notEquals) {
      return false;
    }
    return true;
  }
  if (value === undefined || value === null) {
    return false;
  }
  if ((signal.check ?? "exists") === "available") {
    return (
      params.context.isConfigValueAvailable?.({
        value,
        path: signal.path,
        matchedPath: params.matchedPath,
        signal,
      }) === true
    );
  }
  if ((signal.check ?? "exists") === "exists") {
    return true;
  }
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (typeof value === "object") {
    return Object.keys(value).length > 0;
  }
  return true;
}

function hasAvailabilityExpressionShape(value: ToolAvailabilityExpression): boolean {
  return "kind" in value || "allOf" in value || "anyOf" in value;
}

function diagnostic(
  reason: ToolAvailabilityDiagnostic["reason"],
  signal: ToolAvailabilitySignal,
  message: string,
): ToolAvailabilityDiagnostic {
  return { reason, signal, message };
}

function evaluateSignal(
  signal: ToolAvailabilitySignal,
  context: ToolAvailabilityContext,
): ToolAvailabilityDiagnostic | null {
  switch (signal.kind) {
    case "always":
      return null;
    case "auth":
      return context.authProviderIds?.has(signal.providerId)
        ? null
        : diagnostic("auth-missing", signal, `Missing auth provider: ${signal.providerId}`);
    case "config": {
      const { value, matchedPath } = resolveConfigSignalValue({
        config: context.config,
        signal,
      });
      const label = matchedPath ?? signal.path ?? signal.paths?.[0] ?? [];
      return hasConfiguredValue({ value, matchedPath, signal, context })
        ? null
        : diagnostic("config-missing", signal, `Missing config path: ${label.join(".")}`);
    }
    case "env":
      return context.env?.[signal.name]?.trim()
        ? null
        : diagnostic("env-missing", signal, `Missing environment value: ${signal.name}`);
    case "plugin-enabled":
      return context.enabledPluginIds?.has(signal.pluginId)
        ? null
        : diagnostic("plugin-disabled", signal, `Plugin is not enabled: ${signal.pluginId}`);
    case "context": {
      const value: JsonPrimitive | undefined = context.values?.[signal.key];
      if (!("equals" in signal)) {
        return value === undefined
          ? diagnostic("context-mismatch", signal, `Missing context value: ${signal.key}`)
          : null;
      }
      return value === signal.equals
        ? null
        : diagnostic("context-mismatch", signal, `Context value did not match: ${signal.key}`);
    }
    default:
      return diagnostic("unsupported-signal", signal, "Unsupported availability signal");
  }
}

function evaluateExpression(
  expression: ToolAvailabilityExpression,
  context: ToolAvailabilityContext,
): readonly ToolAvailabilityDiagnostic[] {
  if ("kind" in expression) {
    const diagnostic = evaluateSignal(expression, context);
    return diagnostic ? [diagnostic] : [];
  }
  if ("allOf" in expression) {
    if (expression.allOf.length === 0) {
      return [
        {
          reason: "unsupported-signal",
          message: "Empty availability allOf group",
        },
      ];
    }
    return expression.allOf.flatMap((entry) => evaluateExpression(entry, context));
  }
  if ("anyOf" in expression) {
    if (expression.anyOf.length === 0) {
      return [
        {
          reason: "unsupported-signal",
          message: "Empty availability anyOf group",
        },
      ];
    }
    const diagnostics = expression.anyOf.map((entry) => evaluateExpression(entry, context));
    return diagnostics.some((entries) => entries.length === 0) ? [] : diagnostics.flat();
  }
  return [
    {
      reason: "unsupported-signal",
      message: "Unsupported availability expression",
    },
  ];
}

export function evaluateToolAvailability(params: {
  descriptor: ToolDescriptor;
  context?: ToolAvailabilityContext;
}): readonly ToolAvailabilityDiagnostic[] {
  const context = params.context ?? {};
  const availability = params.descriptor.availability ?? { kind: "always" };
  if (!hasAvailabilityExpressionShape(availability)) {
    return [
      {
        reason: "unsupported-signal",
        message: "Unsupported availability expression",
      },
    ];
  }
  return evaluateExpression(availability, context);
}
