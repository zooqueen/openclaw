import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

type PluginManifestFile = {
  id?: unknown;
  contracts?: {
    tools?: unknown;
  };
  toolMetadata?: unknown;
};

const STATIC_DESCRIPTOR_REQUIRED_PLUGIN_IDS = new Set(["xai"]);

function walkFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
      continue;
    }
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(entryPath));
      continue;
    }
    files.push(entryPath);
  }
  return files;
}

function isProductionSource(filePath: string): boolean {
  if (!/\.(?:cjs|mjs|js|ts|tsx)$/.test(filePath)) {
    return false;
  }
  const normalized = filePath.split(path.sep).join("/");
  return !/(\.test\.|\.spec\.|\/__tests__\/|\/test-support\/)/.test(normalized);
}

function readBalancedCallArguments(source: string, openParenIndex: number): string | undefined {
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  for (let index = openParenIndex; index < source.length; index += 1) {
    const char = source[index];
    if (!char) {
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0 && char === ")") {
        return source.slice(openParenIndex + 1, index);
      }
    }
  }
  return undefined;
}

function listRegisterToolCalls(source: string): string[] {
  const calls: string[] = [];
  const pattern = /\bregisterTool\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    const openParenIndex = source.indexOf("(", match.index);
    const args = readBalancedCallArguments(source, openParenIndex);
    if (args !== undefined) {
      calls.push(args);
    }
  }
  return calls;
}

function splitTopLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: '"' | "'" | "`" | undefined;
  let escaped = false;
  let start = 0;
  for (let index = 0; index < args.length; index += 1) {
    const char = args[index];
    if (!char) {
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === quote) {
        quote = undefined;
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "{" || char === "[") {
      depth += 1;
      continue;
    }
    if (char === ")" || char === "}" || char === "]") {
      depth -= 1;
      continue;
    }
    if (char === "," && depth === 0) {
      parts.push(args.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(args.slice(start).trim());
  return parts.filter(Boolean);
}

function extractStringLiterals(source: string): string[] {
  const names: string[] = [];
  const pattern = /["']([^"']+)["']/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match[1]) {
      names.push(match[1]);
    }
  }
  return names;
}

function extractStaticRegisteredToolNamesFromObject(source: string): string[] {
  const names = new Set<string>();
  const namesPattern = /\bnames\s*:\s*\[([\s\S]*?)\]/g;
  let namesMatch: RegExpExecArray | null;
  while ((namesMatch = namesPattern.exec(source))) {
    for (const name of extractStringLiterals(namesMatch[1] ?? "")) {
      names.add(name);
    }
  }

  const namePattern = /\bname\s*:\s*["']([^"']+)["']/g;
  let nameMatch: RegExpExecArray | null;
  while ((nameMatch = namePattern.exec(source))) {
    if (nameMatch[1]) {
      names.add(nameMatch[1]);
    }
  }
  return [...names];
}

function extractStaticRegisteredToolNames(callArgs: string): string[] {
  const args = splitTopLevelArgs(callArgs);
  const names = new Set<string>();
  const firstArg = args[0]?.trim() ?? "";
  const optionsArg = args[1]?.trim() ?? "";
  if (firstArg.startsWith("{")) {
    for (const name of extractStaticRegisteredToolNamesFromObject(firstArg)) {
      names.add(name);
    }
  }
  if (optionsArg.startsWith("{")) {
    for (const name of extractStaticRegisteredToolNamesFromObject(optionsArg)) {
      names.add(name);
    }
  }
  return [...names];
}

function readManifest(manifestPath: string): PluginManifestFile {
  return JSON.parse(fs.readFileSync(manifestPath, "utf-8")) as PluginManifestFile;
}

function normalizeManifestTools(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.trim() !== "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function hasCompleteToolDescriptor(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }
  const descriptor = value.descriptor;
  return (
    isRecord(descriptor) &&
    typeof descriptor.description === "string" &&
    descriptor.description.trim() !== "" &&
    isRecord(descriptor.inputSchema)
  );
}

describe("bundled plugin tool manifest contracts", () => {
  it("declares every production registerTool owner in contracts.tools", () => {
    const extensionsDir = path.join(process.cwd(), "extensions");
    const failures: string[] = [];

    for (const entry of fs.readdirSync(extensionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) {
        continue;
      }
      const pluginDir = path.join(extensionsDir, entry.name);
      const manifestPath = path.join(pluginDir, "openclaw.plugin.json");
      if (!fs.existsSync(manifestPath)) {
        continue;
      }

      const manifest = readManifest(manifestPath);
      const pluginId = typeof manifest.id === "string" ? manifest.id : entry.name;
      const declaredTools = new Set(normalizeManifestTools(manifest.contracts?.tools));
      const registeredNames = new Set<string>();
      let registerCallCount = 0;

      for (const filePath of walkFiles(pluginDir).filter(isProductionSource)) {
        const source = fs.readFileSync(filePath, "utf-8");
        for (const call of listRegisterToolCalls(source)) {
          registerCallCount += 1;
          for (const name of extractStaticRegisteredToolNames(call)) {
            registeredNames.add(name);
          }
        }
      }

      if (registerCallCount === 0) {
        continue;
      }
      if (declaredTools.size === 0) {
        failures.push(`${pluginId}: registers agent tools but has no contracts.tools`);
        continue;
      }

      const missing = [...registeredNames].filter((name) => !declaredTools.has(name)).toSorted();
      if (missing.length > 0) {
        failures.push(`${pluginId}: missing contracts.tools for ${missing.join(", ")}`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps migrated plugin tool owners on static descriptors", () => {
    const extensionsDir = path.join(process.cwd(), "extensions");
    const failures: string[] = [];

    for (const pluginId of STATIC_DESCRIPTOR_REQUIRED_PLUGIN_IDS) {
      const manifestPath = path.join(extensionsDir, pluginId, "openclaw.plugin.json");
      const manifest = readManifest(manifestPath);
      const declaredTools = normalizeManifestTools(manifest.contracts?.tools);
      const toolMetadata = isRecord(manifest.toolMetadata) ? manifest.toolMetadata : {};

      if (declaredTools.length === 0) {
        failures.push(`${pluginId}: has no contracts.tools`);
        continue;
      }

      for (const toolName of declaredTools) {
        if (!hasCompleteToolDescriptor(toolMetadata[toolName])) {
          failures.push(`${pluginId}: missing static descriptor for ${toolName}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });
});
