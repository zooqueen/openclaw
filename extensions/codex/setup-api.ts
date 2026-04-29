import type { OpenClawConfig, PluginOnboardingContext } from "openclaw/plugin-sdk/plugin-entry";
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { formatComputerUseSetupResult } from "./src/command-formatters.js";

type CodexComputerUseSetupPermissions =
  typeof import("./src/app-server/computer-use.js").setupCodexComputerUsePermissions;

type CodexOnboardingDeps = {
  platform?: NodeJS.Platform;
  setupCodexComputerUsePermissions?: CodexComputerUseSetupPermissions;
};

const CODEX_PLUGIN_ID = "codex";
const CODEX_RUNTIME_ID = "codex";
const OPENAI_PROVIDER_PREFIX = "openai/";
const OPENAI_CODEX_PROVIDER_PREFIX = "openai-codex/";
const LEGACY_CODEX_PROVIDER_PREFIX = "codex/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function readPrimaryModel(config: OpenClawConfig): string {
  const model = config.agents?.defaults?.model;
  if (typeof model === "string") {
    return model.trim();
  }
  return isRecord(model) ? normalizeString(model.primary) : "";
}

function hasCodexRuntime(config: OpenClawConfig): boolean {
  const defaultsRuntime = config.agents?.defaults?.agentRuntime;
  if (normalizeString(defaultsRuntime?.id).toLowerCase() === CODEX_RUNTIME_ID) {
    return true;
  }
  const agents = config.agents?.list;
  return Array.isArray(agents)
    ? agents.some(
        (agent) =>
          isRecord(agent) &&
          isRecord(agent.agentRuntime) &&
          normalizeString(agent.agentRuntime.id).toLowerCase() === CODEX_RUNTIME_ID,
      )
    : false;
}

function resolveNativeCodexModelRef(primaryModel: string): string | null {
  if (primaryModel.startsWith(OPENAI_CODEX_PROVIDER_PREFIX)) {
    const modelId = primaryModel.slice(OPENAI_CODEX_PROVIDER_PREFIX.length).trim();
    return modelId ? `${OPENAI_PROVIDER_PREFIX}${modelId}` : null;
  }
  if (primaryModel.startsWith(LEGACY_CODEX_PROVIDER_PREFIX)) {
    const modelId = primaryModel.slice(LEGACY_CODEX_PROVIDER_PREFIX.length).trim();
    return modelId ? `${OPENAI_PROVIDER_PREFIX}${modelId}` : null;
  }
  return null;
}

function withPrimaryModel(config: OpenClawConfig, primaryModel: string): OpenClawConfig {
  const defaults = config.agents?.defaults ?? {};
  const existingModel = defaults.model;
  const existingModels = defaults.models ?? {};
  const model = isRecord(existingModel)
    ? {
        ...existingModel,
        primary: primaryModel,
      }
    : {
        primary: primaryModel,
      };
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...defaults,
        models: {
          ...existingModels,
          [primaryModel]: existingModels[primaryModel] ?? {},
        },
        model,
      },
    },
  };
}

function withCodexRuntime(config: OpenClawConfig): OpenClawConfig {
  const defaults = config.agents?.defaults ?? {};
  return {
    ...config,
    agents: {
      ...config.agents,
      defaults: {
        ...defaults,
        agentRuntime: {
          ...defaults.agentRuntime,
          id: CODEX_RUNTIME_ID,
          fallback: defaults.agentRuntime?.fallback ?? "none",
        },
      },
    },
  };
}

function readCodexPluginEntry(config: OpenClawConfig): Record<string, unknown> {
  const entry = config.plugins?.entries?.[CODEX_PLUGIN_ID];
  return isRecord(entry) ? entry : {};
}

function readCodexPluginConfig(config: OpenClawConfig): Record<string, unknown> {
  const pluginConfig = readCodexPluginEntry(config).config;
  return isRecord(pluginConfig) ? pluginConfig : {};
}

function withCodexPluginEnabled(config: OpenClawConfig): OpenClawConfig {
  const entry = readCodexPluginEntry(config);
  return {
    ...config,
    plugins: {
      ...config.plugins,
      entries: {
        ...config.plugins?.entries,
        [CODEX_PLUGIN_ID]: {
          ...entry,
          enabled: true,
          config: readCodexPluginConfig(config),
        },
      },
    },
  };
}

function withComputerUseConfig(config: OpenClawConfig): OpenClawConfig {
  const withPlugin = withCodexPluginEnabled(config);
  const entry = readCodexPluginEntry(withPlugin);
  const pluginConfig = readCodexPluginConfig(withPlugin);
  const computerUse = isRecord(pluginConfig.computerUse) ? pluginConfig.computerUse : {};
  return {
    ...withPlugin,
    plugins: {
      ...withPlugin.plugins,
      entries: {
        ...withPlugin.plugins?.entries,
        [CODEX_PLUGIN_ID]: {
          ...entry,
          enabled: true,
          config: {
            ...pluginConfig,
            computerUse: {
              ...computerUse,
              enabled: true,
              autoInstall: true,
            },
          },
        },
      },
    },
  };
}

function isComputerUseExplicitlyDisabled(config: OpenClawConfig): boolean {
  const computerUse = readCodexPluginConfig(config).computerUse;
  return isRecord(computerUse) && computerUse.enabled === false;
}

function hasComputerUseConfig(config: OpenClawConfig): boolean {
  return isRecord(readCodexPluginConfig(config).computerUse);
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function loadComputerUseSetup(): Promise<CodexComputerUseSetupPermissions> {
  const { setupCodexComputerUsePermissions } = await import("./src/app-server/computer-use.js");
  return setupCodexComputerUsePermissions;
}

async function maybeConfigureNativeCodexRuntime(
  ctx: PluginOnboardingContext,
  config: OpenClawConfig,
): Promise<OpenClawConfig> {
  if (hasCodexRuntime(config)) {
    return config;
  }
  const nativeModel = resolveNativeCodexModelRef(readPrimaryModel(config));
  if (!nativeModel) {
    return config;
  }

  await ctx.prompter.note(
    [
      "OpenAI Codex login can use the normal OpenClaw runner, or it can run agent turns through the native Codex app-server runtime.",
      "Native Codex runtime is required for Codex Computer Use.",
    ].join("\n"),
    "Codex runtime",
  );
  const useNativeRuntime = await ctx.prompter.confirm({
    message: "Use native Codex runtime for this agent?",
    initialValue: true,
  });
  if (!useNativeRuntime) {
    return config;
  }
  return withCodexPluginEnabled(withCodexRuntime(withPrimaryModel(config, nativeModel)));
}

async function maybeSetupComputerUse(
  ctx: PluginOnboardingContext,
  config: OpenClawConfig,
  deps: CodexOnboardingDeps,
): Promise<OpenClawConfig> {
  const platform = deps.platform ?? process.platform;
  if (
    platform !== "darwin" ||
    !hasCodexRuntime(config) ||
    isComputerUseExplicitlyDisabled(config)
  ) {
    return config;
  }

  await ctx.prompter.note(
    [
      "Codex Computer Use lets native Codex-mode agents control this Mac through Codex's Computer Use plugin.",
      "Setup installs or re-enables the plugin, then starts the macOS permission flow while you are here.",
    ].join("\n"),
    "Codex Computer Use",
  );
  const shouldSetup = await ctx.prompter.confirm({
    message: "Set up Codex Computer Use now?",
    initialValue: !hasComputerUseConfig(config),
  });
  if (!shouldSetup) {
    return config;
  }

  const candidate = withComputerUseConfig(config);
  const setupCodexComputerUsePermissions =
    deps.setupCodexComputerUsePermissions ?? (await loadComputerUseSetup());
  try {
    const result = await setupCodexComputerUsePermissions({
      cwd: ctx.workspaceDir,
      pluginConfig: readCodexPluginConfig(candidate),
    });
    await ctx.prompter.note(formatComputerUseSetupResult(result), "Codex Computer Use");
    return candidate;
  } catch (error) {
    await ctx.prompter.note(
      [
        `Computer Use setup did not finish: ${formatError(error)}`,
        "You can rerun setup later from chat with /codex computer-use setup.",
      ].join("\n"),
      "Codex Computer Use",
    );
    return config;
  }
}

export async function runCodexOnboardingHook(
  ctx: PluginOnboardingContext,
  deps: CodexOnboardingDeps = {},
): Promise<OpenClawConfig> {
  const nativeConfig = await maybeConfigureNativeCodexRuntime(ctx, ctx.config);
  return await maybeSetupComputerUse(ctx, nativeConfig, deps);
}

export const __testing = {
  runCodexOnboardingHook,
  withComputerUseConfig,
  withCodexRuntime,
  withPrimaryModel,
};

export default definePluginEntry({
  id: CODEX_PLUGIN_ID,
  name: "Codex Setup",
  description: "Lightweight Codex setup hooks",
  register(api) {
    api.registerOnboardingHook((ctx) => runCodexOnboardingHook(ctx));
  },
});
