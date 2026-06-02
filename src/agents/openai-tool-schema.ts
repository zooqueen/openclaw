import type { ModelCompatConfig } from "../config/types.models.js";
import { shouldOmitEmptyArrayItems } from "../plugins/provider-model-compat.js";
import { normalizeToolParameterSchema } from "./agent-tools-parameter-schema.js";

type ToolSchemaCompatInput = {
  unsupportedToolSchemaKeywords?: unknown;
  omitEmptyArrayItems?: unknown;
};

type ToolWithParameters = {
  name?: unknown;
  description?: unknown;
  parameters: unknown;
};

type OpenAIToolProjectionSnapshot = {
  toolIndex: number;
  name: string;
  description?: string;
  parameters: unknown;
};

type OpenAIToolProjectionSnapshotDiagnostic = OpenAIStrictToolSchemaDiagnostic;

const MAX_STRICT_SCHEMA_CACHE_ENTRIES_PER_SCHEMA = 8;
let strictOpenAISchemaCache = new WeakMap<object, Array<{ key: string; value: unknown }>>();

function resolveToolSchemaModelCompat(
  compat: ToolSchemaCompatInput | null | undefined,
): ModelCompatConfig | undefined {
  if (!compat) {
    return undefined;
  }
  const unsupportedToolSchemaKeywords = Array.isArray(compat.unsupportedToolSchemaKeywords)
    ? compat.unsupportedToolSchemaKeywords.filter(
        (keyword): keyword is string => typeof keyword === "string",
      )
    : [];
  if (unsupportedToolSchemaKeywords.length === 0 && compat.omitEmptyArrayItems !== true) {
    return undefined;
  }
  return {
    ...(unsupportedToolSchemaKeywords.length > 0 ? { unsupportedToolSchemaKeywords } : {}),
    ...(compat.omitEmptyArrayItems === true ? { omitEmptyArrayItems: true } : {}),
  };
}

function resolveStrictOpenAISchemaCacheKey(
  modelCompat: ToolSchemaCompatInput | null | undefined,
): string {
  const compat = resolveToolSchemaModelCompat(modelCompat);
  return JSON.stringify([
    [...(compat?.unsupportedToolSchemaKeywords ?? [])].toSorted(),
    shouldOmitEmptyArrayItems(compat),
  ]);
}

function readCachedStrictOpenAISchema(schema: object, key: string): unknown {
  return strictOpenAISchemaCache.get(schema)?.find((entry) => entry.key === key)?.value;
}

function rememberStrictOpenAISchema(schema: object, key: string, value: unknown): unknown {
  const entries = strictOpenAISchemaCache.get(schema) ?? [];
  strictOpenAISchemaCache.set(
    schema,
    [{ key, value }, ...entries.filter((entry) => entry.key !== key)].slice(
      0,
      MAX_STRICT_SCHEMA_CACHE_ENTRIES_PER_SCHEMA,
    ),
  );
  return value;
}

export function clearOpenAIToolSchemaCacheForTest(): void {
  strictOpenAISchemaCache = new WeakMap();
}

export function normalizeStrictOpenAIJsonSchema(
  schema: unknown,
  modelCompat?: ToolSchemaCompatInput | null,
): unknown {
  const schemaInput = schema ?? {};
  if (!schemaInput || typeof schemaInput !== "object") {
    return normalizeStrictOpenAIJsonSchemaRecursive(
      normalizeToolParameterSchema(schemaInput, {
        modelCompat: resolveToolSchemaModelCompat(modelCompat),
      }),
      0,
    );
  }
  const cacheKey = resolveStrictOpenAISchemaCacheKey(modelCompat);
  const cached = readCachedStrictOpenAISchema(schemaInput, cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  return rememberStrictOpenAISchema(
    schemaInput,
    cacheKey,
    normalizeStrictOpenAIJsonSchemaRecursive(
      normalizeToolParameterSchema(schemaInput, {
        modelCompat: resolveToolSchemaModelCompat(modelCompat),
      }),
      0,
    ),
  );
}

function normalizeStrictOpenAIJsonSchemaRecursive(schema: unknown, depth: number): unknown {
  if (Array.isArray(schema)) {
    let changed = false;
    const normalized = schema.map((entry) => {
      const next = normalizeStrictOpenAIJsonSchemaRecursive(entry, depth);
      changed ||= next !== entry;
      return next;
    });
    return changed ? normalized : schema;
  }
  if (!schema || typeof schema !== "object") {
    return schema;
  }

  const record = schema as Record<string, unknown>;
  let changed = false;
  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    const next = normalizeStrictOpenAIJsonSchemaRecursive(
      value,
      key === "properties" ? depth : depth + 1,
    );
    normalized[key] = next;
    changed ||= next !== value;
  }

  if (normalized.type === "object") {
    const properties =
      normalized.properties &&
      typeof normalized.properties === "object" &&
      !Array.isArray(normalized.properties)
        ? (normalized.properties as Record<string, unknown>)
        : undefined;
    if (properties && Object.keys(properties).length === 0 && !Array.isArray(normalized.required)) {
      normalized.required = [];
      changed = true;
    }
    if (depth === 0 && !("additionalProperties" in normalized)) {
      normalized.additionalProperties = false;
      changed = true;
    }
  }

  return changed ? normalized : schema;
}

export function normalizeOpenAIStrictToolParameters<T>(
  schema: T,
  strict: boolean,
  modelCompat?: ToolSchemaCompatInput | null,
): T {
  const toolSchemaCompat = resolveToolSchemaModelCompat(modelCompat);
  if (!strict) {
    return normalizeToolParameterSchema(schema ?? {}, { modelCompat: toolSchemaCompat }) as T;
  }
  return normalizeStrictOpenAIJsonSchema(schema, toolSchemaCompat) as T;
}

export function isStrictOpenAIJsonSchemaCompatible(schema: unknown): boolean {
  return isStrictOpenAIJsonSchemaCompatibleRecursive(normalizeStrictOpenAIJsonSchema(schema));
}

type OpenAIStrictToolSchemaDiagnostic = {
  toolIndex: number;
  toolName?: string;
  violations: string[];
};

export function snapshotOpenAIToolProjectionInputs(tools: readonly ToolWithParameters[]): {
  tools: OpenAIToolProjectionSnapshot[];
  diagnostics: OpenAIToolProjectionSnapshotDiagnostic[];
} {
  const snapshots: OpenAIToolProjectionSnapshot[] = [];
  const diagnostics: OpenAIToolProjectionSnapshotDiagnostic[] = [];
  tools.forEach((tool, toolIndex) => {
    const fallbackPath = `tool[${toolIndex}]`;
    let toolName: string | undefined;
    try {
      if (!tool || typeof tool !== "object") {
        diagnostics.push({ toolIndex, violations: [`${fallbackPath}.tool`] });
        return;
      }
      const name = Reflect.get(tool, "name");
      if (typeof name !== "string" || name.length === 0) {
        diagnostics.push({ toolIndex, violations: [`${fallbackPath}.name`] });
        return;
      }
      toolName = name;
      const description = Reflect.get(tool, "description");
      const parameters = Reflect.get(tool, "parameters");
      snapshots.push({
        toolIndex,
        name,
        ...(typeof description === "string" ? { description } : {}),
        parameters,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      diagnostics.push({
        toolIndex,
        ...(toolName ? { toolName } : {}),
        violations: [`${toolName ?? fallbackPath}.unreadable: ${message}`],
      });
    }
  });
  return { tools: snapshots, diagnostics };
}

export function findOpenAIStrictToolSchemaDiagnostics(
  tools: readonly ToolWithParameters[],
): OpenAIStrictToolSchemaDiagnostic[] {
  const snapshot = snapshotOpenAIToolProjectionInputs(tools);
  return [
    ...snapshot.diagnostics,
    ...snapshot.tools.flatMap((tool) => {
      const violations = findStrictOpenAIJsonSchemaViolations(
        normalizeStrictOpenAIJsonSchema(tool.parameters),
        `${tool.name}.parameters`,
      );
      if (violations.length === 0) {
        return [];
      }
      return [
        {
          toolIndex: tool.toolIndex,
          toolName: tool.name,
          violations,
        },
      ];
    }),
  ];
}

function isStrictOpenAIJsonSchemaCompatibleRecursive(schema: unknown): boolean {
  if (Array.isArray(schema)) {
    return schema.every((entry) => isStrictOpenAIJsonSchemaCompatibleRecursive(entry));
  }
  if (!schema || typeof schema !== "object") {
    return true;
  }

  const record = schema as Record<string, unknown>;
  if ("anyOf" in record || "oneOf" in record || "allOf" in record) {
    return false;
  }
  if (Array.isArray(record.type)) {
    return false;
  }
  if (record.type === "object" && record.additionalProperties !== false) {
    return false;
  }
  if (record.type === "object") {
    const properties =
      record.properties &&
      typeof record.properties === "object" &&
      !Array.isArray(record.properties)
        ? (record.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(record.required)
      ? record.required.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    if (!required) {
      return false;
    }
    const requiredSet = new Set(required);
    if (Object.keys(properties).some((key) => !requiredSet.has(key))) {
      return false;
    }
  }

  return Object.entries(record).every(([key, entry]) => {
    if (key === "properties" && entry && typeof entry === "object" && !Array.isArray(entry)) {
      return Object.values(entry as Record<string, unknown>).every((value) =>
        isStrictOpenAIJsonSchemaCompatibleRecursive(value),
      );
    }
    return isStrictOpenAIJsonSchemaCompatibleRecursive(entry);
  });
}

function findStrictOpenAIJsonSchemaViolations(schema: unknown, path: string): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((entry, index) =>
      findStrictOpenAIJsonSchemaViolations(entry, `${path}[${index}]`),
    );
  }
  if (!schema || typeof schema !== "object") {
    return [];
  }

  const record = schema as Record<string, unknown>;
  const violations: string[] = [];
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (key in record) {
      violations.push(`${path}.${key}`);
    }
  }
  if (Array.isArray(record.type)) {
    violations.push(`${path}.type`);
  }
  if (record.type === "object") {
    if (record.additionalProperties !== false) {
      violations.push(`${path}.additionalProperties`);
    }
    const properties =
      record.properties &&
      typeof record.properties === "object" &&
      !Array.isArray(record.properties)
        ? (record.properties as Record<string, unknown>)
        : {};
    const required = Array.isArray(record.required)
      ? record.required.filter((entry): entry is string => typeof entry === "string")
      : undefined;
    if (!required) {
      violations.push(`${path}.required`);
    } else {
      const requiredSet = new Set(required);
      for (const key of Object.keys(properties)) {
        if (!requiredSet.has(key)) {
          violations.push(`${path}.required.${key}`);
        }
      }
    }
  }

  if (
    record.properties &&
    typeof record.properties === "object" &&
    !Array.isArray(record.properties)
  ) {
    for (const [key, value] of Object.entries(record.properties)) {
      violations.push(...findStrictOpenAIJsonSchemaViolations(value, `${path}.properties.${key}`));
    }
  }
  for (const [key, value] of Object.entries(record)) {
    if (key === "properties") {
      continue;
    }
    if (value && typeof value === "object") {
      violations.push(...findStrictOpenAIJsonSchemaViolations(value, `${path}.${key}`));
    }
  }

  return violations;
}

export function resolveOpenAIStrictToolFlagForInventory(
  tools: readonly ToolWithParameters[],
  strict: boolean | null | undefined,
): boolean | undefined {
  if (strict !== true) {
    return strict === false ? false : undefined;
  }
  const snapshot = snapshotOpenAIToolProjectionInputs(tools);
  return (
    snapshot.diagnostics.length === 0 &&
    snapshot.tools.every((tool) => isStrictOpenAIJsonSchemaCompatible(tool.parameters))
  );
}
