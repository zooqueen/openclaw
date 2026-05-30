import { normalizeProviderId } from "../agents/provider-id.js";
import type { PluginManifestRecord } from "./manifest-registry.js";

type SetupDescriptorRecord = Pick<
  PluginManifestRecord,
  "providers" | "cliBackends" | "providerAuthAliases" | "setup"
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readRecordValue(record: unknown, key: string): unknown {
  if (!isRecord(record)) {
    return undefined;
  }
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function copyArrayEntries(value: unknown): unknown[] {
  if (!Array.isArray(value)) {
    return [];
  }
  let length: number;
  try {
    length = value.length;
  } catch {
    return [];
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      entries.push(value[index]);
    } catch {
      continue;
    }
  }
  return entries;
}

function readStringList(value: unknown): string[] {
  return copyArrayEntries(value).filter((entry): entry is string => typeof entry === "string");
}

function readSetupProviderIds(record: SetupDescriptorRecord): string[] {
  const setupProviders = readRecordValue(readRecordValue(record, "setup"), "providers");
  const setupProviderIds = copyArrayEntries(setupProviders)
    .map((entry) => readRecordValue(entry, "id"))
    .filter((entry): entry is string => typeof entry === "string");
  return setupProviderIds.length > 0
    ? setupProviderIds
    : readStringList(readRecordValue(record, "providers"));
}

function readSetupCliBackendIds(record: SetupDescriptorRecord): string[] {
  const setupCliBackends = readStringList(
    readRecordValue(readRecordValue(record, "setup"), "cliBackends"),
  );
  return setupCliBackends.length > 0
    ? setupCliBackends
    : readStringList(readRecordValue(record, "cliBackends"));
}

function readProviderAuthAliases(record: SetupDescriptorRecord): Array<[string, string]> {
  const aliases = readRecordValue(record, "providerAuthAliases");
  if (!isRecord(aliases)) {
    return [];
  }
  let entries: Array<[string, unknown]>;
  try {
    entries = Object.entries(aliases);
  } catch {
    return [];
  }
  return entries.filter((entry): entry is [string, string] => typeof entry[1] === "string");
}

export function listSetupProviderIds(record: SetupDescriptorRecord): readonly string[] {
  const providerIds = readSetupProviderIds(record);
  const normalizedProviderIds = new Set(providerIds.map(normalizeProviderId));
  const aliases = readProviderAuthAliases(record)
    .filter(([, target]) => normalizedProviderIds.has(normalizeProviderId(target)))
    .map(([alias]) => alias);
  return [...providerIds, ...aliases];
}

export function listSetupCliBackendIds(record: SetupDescriptorRecord): readonly string[] {
  return readSetupCliBackendIds(record);
}
