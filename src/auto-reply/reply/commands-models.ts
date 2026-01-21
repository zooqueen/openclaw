import { loadModelCatalog } from "../../agents/model-catalog.js";
import {
  buildAllowedModelSet,
  buildModelAliasIndex,
  normalizeProviderId,
  resolveConfiguredModelRef,
  resolveModelRefFromString,
} from "../../agents/model-selection.js";
import { DEFAULT_MODEL, DEFAULT_PROVIDER } from "../../agents/defaults.js";
import type { ReplyPayload } from "../types.js";
import type { CommandHandler } from "./commands-types.js";

const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

function formatProviderLine(params: { provider: string; count: number }): string {
  return `- ${params.provider} (${params.count})`;
}

function addModelRef(map: Map<string, Set<string>>, provider: string, model: string): void {
  const normalizedProvider = normalizeProviderId(provider);
  const normalizedModel = String(model ?? "").trim();
  if (!normalizedProvider || !normalizedModel) return;
  const set = map.get(normalizedProvider) ?? new Set<string>();
  set.add(normalizedModel);
  map.set(normalizedProvider, set);
}

function parseModelsArgs(raw: string): {
  provider?: string;
  page: number;
  pageSize: number;
  all: boolean;
} {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { page: 1, pageSize: PAGE_SIZE_DEFAULT, all: false };
  }

  const tokens = trimmed.split(/\s+/g).filter(Boolean);
  const provider = tokens[0]?.trim();

  let page = 1;
  let all = false;
  for (const token of tokens.slice(1)) {
    const lower = token.toLowerCase();
    if (lower === "all" || lower === "--all") {
      all = true;
      continue;
    }
    if (lower.startsWith("page=")) {
      const value = Number.parseInt(lower.slice("page=".length), 10);
      if (Number.isFinite(value) && value > 0) page = value;
      continue;
    }
    if (/^[0-9]+$/.test(lower)) {
      const value = Number.parseInt(lower, 10);
      if (Number.isFinite(value) && value > 0) page = value;
    }
  }

  let pageSize = PAGE_SIZE_DEFAULT;
  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower.startsWith("limit=") || lower.startsWith("size=")) {
      const rawValue = lower.slice(lower.indexOf("=") + 1);
      const value = Number.parseInt(rawValue, 10);
      if (Number.isFinite(value) && value > 0) pageSize = Math.min(PAGE_SIZE_MAX, value);
    }
  }

  return {
    provider: provider ? normalizeProviderId(provider) : undefined,
    page,
    pageSize,
    all,
  };
}

export const handleModelsCommand: CommandHandler = async (params, allowTextCommands) => {
  if (!allowTextCommands) return null;

  const body = params.command.commandBodyNormalized.trim();
  if (!body.startsWith("/models")) return null;

  const argText = body.replace(/^\/models\b/i, "").trim();
  const { provider, page, pageSize, all } = parseModelsArgs(argText);

  const resolvedDefault = resolveConfiguredModelRef({
    cfg: params.cfg,
    defaultProvider: DEFAULT_PROVIDER,
    defaultModel: DEFAULT_MODEL,
  });

  const catalog = await loadModelCatalog({ config: params.cfg });
  const allowed = buildAllowedModelSet({
    cfg: params.cfg,
    catalog,
    defaultProvider: resolvedDefault.provider,
    defaultModel: resolvedDefault.model,
  });

  const byProvider = new Map<string, Set<string>>();
  const aliasIndex = buildModelAliasIndex({
    cfg: params.cfg,
    defaultProvider: resolvedDefault.provider,
  });
  const addRaw = (raw?: string) => {
    const value = String(raw ?? "").trim();
    if (!value) return;
    const resolved = resolveModelRefFromString({
      raw: value,
      defaultProvider: resolvedDefault.provider,
      aliasIndex,
    });
    if (!resolved) return;
    addModelRef(byProvider, resolved.ref.provider, resolved.ref.model);
  };

  for (const entry of allowed.allowedCatalog) {
    addModelRef(byProvider, entry.provider, entry.id);
  }

  addModelRef(byProvider, resolvedDefault.provider, resolvedDefault.model);

  const modelConfig = params.cfg.agents?.defaults?.model;
  const modelFallbacks =
    modelConfig && typeof modelConfig === "object" ? (modelConfig.fallbacks ?? []) : [];
  for (const fallback of modelFallbacks) {
    addRaw(String(fallback ?? ""));
  }

  const imageConfig = params.cfg.agents?.defaults?.imageModel;
  if (imageConfig) {
    if (typeof imageConfig === "string") {
      addRaw(imageConfig);
    } else {
      addRaw(imageConfig.primary);
      for (const fallback of imageConfig.fallbacks ?? []) {
        addRaw(String(fallback ?? ""));
      }
    }
  }

  for (const raw of Object.keys(params.cfg.agents?.defaults?.models ?? {})) {
    addRaw(String(raw ?? ""));
  }

  for (const [provider, providerConfig] of Object.entries(params.cfg.models?.providers ?? {})) {
    for (const modelDef of providerConfig?.models ?? []) {
      addModelRef(byProvider, provider, modelDef?.id ?? "");
    }
  }

  const providers = [...byProvider.keys()].sort();

  if (!provider) {
    const lines: string[] = [
      "Providers:",
      ...providers.map((p) =>
        formatProviderLine({ provider: p, count: byProvider.get(p)?.size ?? 0 }),
      ),
      "",
      "Use: /models <provider>",
      "Switch: /model <provider/model>",
    ];
    return { reply: { text: lines.join("\n") }, shouldContinue: false };
  }

  if (!byProvider.has(provider)) {
    const lines: string[] = [
      `Unknown provider: ${provider}`,
      "",
      "Available providers:",
      ...providers.map((p) => `- ${p}`),
      "",
      "Use: /models <provider>",
    ];
    return { reply: { text: lines.join("\n") }, shouldContinue: false };
  }

  const models = [...(byProvider.get(provider) ?? new Set<string>())].sort();
  const total = models.length;

  if (total === 0) {
    const lines: string[] = [
      `Models (${provider}) — none`,
      "",
      "Browse: /models",
      "Switch: /model <provider/model>",
    ];
    return { reply: { text: lines.join("\n") }, shouldContinue: false };
  }

  const effectivePageSize = all ? total : pageSize;
  const pageCount = effectivePageSize > 0 ? Math.ceil(total / effectivePageSize) : 1;
  const safePage = all ? 1 : Math.max(1, Math.min(page, pageCount));

  if (!all && page !== safePage) {
    const lines: string[] = [
      `Page out of range: ${page} (valid: 1-${pageCount})`,
      "",
      `Try: /models ${provider} ${safePage}`,
      `All: /models ${provider} all`,
    ];
    return { reply: { text: lines.join("\n") }, shouldContinue: false };
  }

  const startIndex = (safePage - 1) * effectivePageSize;
  const endIndexExclusive = Math.min(total, startIndex + effectivePageSize);
  const pageModels = models.slice(startIndex, endIndexExclusive);

  const header = `Models (${provider}) — showing ${startIndex + 1}-${endIndexExclusive} of ${total} (page ${safePage}/${pageCount})`;

  const lines: string[] = [header];
  for (const id of pageModels) {
    lines.push(`- ${provider}/${id}`);
  }

  lines.push("", "Switch: /model <provider/model>");
  if (!all && safePage < pageCount) {
    lines.push(`More: /models ${provider} ${safePage + 1}`);
  }
  if (!all) {
    lines.push(`All: /models ${provider} all`);
  }

  const payload: ReplyPayload = { text: lines.join("\n") };
  return { reply: payload, shouldContinue: false };
};
