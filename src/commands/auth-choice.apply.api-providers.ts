import { ensureAuthProfileStore, resolveAuthProfileOrder } from "../agents/auth-profiles.js";
import { normalizeProviderId } from "../agents/model-selection.js";
import { resolveEnvApiKey } from "../agents/model-auth.js";
import {
  formatApiKeyPreview,
  normalizeApiKeyInput,
  validateApiKeyInput,
} from "./auth-choice.api-key.js";
import type { ApplyAuthChoiceParams, ApplyAuthChoiceResult } from "./auth-choice.apply.js";
import type { AuthChoice } from "./onboard-types.js";
import { applyDefaultModelChoice } from "./auth-choice.default-model.js";
import {
  applyGoogleGeminiModelDefault,
  GOOGLE_GEMINI_DEFAULT_MODEL,
} from "./google-gemini-model-default.js";
import {
  applyAuthProfileConfig,
  applyKimiCodeConfig,
  applyKimiCodeProviderConfig,
  applyMoonshotConfig,
  applyMoonshotProviderConfig,
  applyOpencodeZenConfig,
  applyOpencodeZenProviderConfig,
  applyOpenrouterConfig,
  applyOpenrouterProviderConfig,
  applySyntheticConfig,
  applySyntheticProviderConfig,
  applyVercelAiGatewayConfig,
  applyVercelAiGatewayProviderConfig,
  applyZaiConfig,
  KIMI_CODE_MODEL_REF,
  MOONSHOT_DEFAULT_MODEL_REF,
  OPENROUTER_DEFAULT_MODEL_REF,
  SYNTHETIC_DEFAULT_MODEL_REF,
  VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
  setGeminiApiKey,
  setKimiCodeApiKey,
  setMoonshotApiKey,
  setOpencodeZenApiKey,
  setOpenrouterApiKey,
  setSyntheticApiKey,
  setVercelAiGatewayApiKey,
  setZaiApiKey,
  ZAI_DEFAULT_MODEL_REF,
} from "./onboard-auth.js";
import { OPENCODE_ZEN_DEFAULT_MODEL } from "./opencode-zen-model-default.js";

export async function applyAuthChoiceApiProviders(
  params: ApplyAuthChoiceParams,
): Promise<ApplyAuthChoiceResult | null> {
  let nextConfig = params.config;
  let agentModelOverride: string | undefined;
  const noteAgentModel = async (model: string) => {
    if (!params.agentId) return;
    await params.prompter.note(
      `Default model set to ${model} for agent "${params.agentId}".`,
      "Model configured",
    );
  };

  const tokenProvider = params.opts?.tokenProvider
    ? normalizeProviderId(params.opts.tokenProvider)
    : undefined;
  const tokenValue = params.opts?.token;
  let authChoice = params.authChoice;
  if (
    authChoice === "apiKey" &&
    tokenProvider &&
    tokenProvider !== "anthropic" &&
    tokenProvider !== "openai"
  ) {
    const mapped: Partial<Record<string, AuthChoice>> = {
      openrouter: "openrouter-api-key",
      "vercel-ai-gateway": "ai-gateway-api-key",
      moonshot: "moonshot-api-key",
      "kimi-code": "kimi-code-api-key",
      google: "gemini-api-key",
      zai: "zai-api-key",
      synthetic: "synthetic-api-key",
      opencode: "opencode-zen",
    };
    authChoice = mapped[tokenProvider] ?? authChoice;
  }

  if (authChoice === "openrouter-api-key") {
    let profileId = "openrouter:default";
    let mode: "api_key" | "oauth" | "token" = "api_key";
    let hasCredential = false;
    const explicitToken =
      tokenProvider === "openrouter" ? normalizeApiKeyInput(tokenValue ?? "") : "";

    if (explicitToken) {
      await setOpenrouterApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    } else {
      const store = ensureAuthProfileStore(params.agentDir, {
        allowKeychainPrompt: false,
      });
      const profileOrder = resolveAuthProfileOrder({
        cfg: nextConfig,
        store,
        provider: "openrouter",
      });
      const existingProfileId = profileOrder.find((profileId) =>
        Boolean(store.profiles[profileId]),
      );
      const existingCred = existingProfileId ? store.profiles[existingProfileId] : undefined;
      if (existingProfileId && existingCred?.type) {
        profileId = existingProfileId;
        mode =
          existingCred.type === "oauth"
            ? "oauth"
            : existingCred.type === "token"
              ? "token"
              : "api_key";
        hasCredential = true;
      }

      if (!hasCredential) {
        const envKey = resolveEnvApiKey("openrouter");
        if (envKey) {
          const useExisting = await params.prompter.confirm({
            message: `Use existing OPENROUTER_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
            initialValue: true,
          });
          if (useExisting) {
            await setOpenrouterApiKey(envKey.apiKey, params.agentDir);
            hasCredential = true;
          }
        }
      }

      if (!hasCredential) {
        const key = await params.prompter.text({
          message: "Enter OpenRouter API key",
          validate: validateApiKeyInput,
        });
        await setOpenrouterApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
        hasCredential = true;
      }
    }

    if (hasCredential) {
      nextConfig = applyAuthProfileConfig(nextConfig, {
        profileId,
        provider: "openrouter",
        mode,
      });
    }
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: OPENROUTER_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyOpenrouterConfig,
        applyProviderConfig: applyOpenrouterProviderConfig,
        noteDefault: OPENROUTER_DEFAULT_MODEL_REF,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "ai-gateway-api-key") {
    let hasCredential = false;
    const explicitToken =
      tokenProvider === "vercel-ai-gateway" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setVercelAiGatewayApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    const envKey = resolveEnvApiKey("vercel-ai-gateway");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing AI_GATEWAY_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setVercelAiGatewayApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter Vercel AI Gateway API key",
        validate: validateApiKeyInput,
      });
      await setVercelAiGatewayApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "vercel-ai-gateway:default",
      provider: "vercel-ai-gateway",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyVercelAiGatewayConfig,
        applyProviderConfig: applyVercelAiGatewayProviderConfig,
        noteDefault: VERCEL_AI_GATEWAY_DEFAULT_MODEL_REF,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "moonshot-api-key") {
    let hasCredential = false;
    const explicitToken =
      tokenProvider === "moonshot" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setMoonshotApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    const envKey = resolveEnvApiKey("moonshot");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing MOONSHOT_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setMoonshotApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter Moonshot API key",
        validate: validateApiKeyInput,
      });
      await setMoonshotApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "moonshot:default",
      provider: "moonshot",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: MOONSHOT_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyMoonshotConfig,
        applyProviderConfig: applyMoonshotProviderConfig,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "kimi-code-api-key") {
    let hasCredential = false;
    const explicitToken =
      tokenProvider === "kimi-code" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setKimiCodeApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    if (!hasCredential) {
      await params.prompter.note(
        [
          "Kimi Code uses a dedicated endpoint and API key.",
          "Get your API key at: https://www.kimi.com/code/en",
        ].join("\n"),
        "Kimi Code",
      );
    }
    const envKey = resolveEnvApiKey("kimi-code");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing KIMICODE_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setKimiCodeApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter Kimi Code API key",
        validate: validateApiKeyInput,
      });
      await setKimiCodeApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "kimi-code:default",
      provider: "kimi-code",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: KIMI_CODE_MODEL_REF,
        applyDefaultConfig: applyKimiCodeConfig,
        applyProviderConfig: applyKimiCodeProviderConfig,
        noteDefault: KIMI_CODE_MODEL_REF,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "gemini-api-key") {
    let hasCredential = false;
    const explicitToken = tokenProvider === "google" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setGeminiApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    const envKey = resolveEnvApiKey("google");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing GEMINI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setGeminiApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter Gemini API key",
        validate: validateApiKeyInput,
      });
      await setGeminiApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "google:default",
      provider: "google",
      mode: "api_key",
    });
    if (params.setDefaultModel) {
      const applied = applyGoogleGeminiModelDefault(nextConfig);
      nextConfig = applied.next;
      if (applied.changed) {
        await params.prompter.note(
          `Default model set to ${GOOGLE_GEMINI_DEFAULT_MODEL}`,
          "Model configured",
        );
      }
    } else {
      agentModelOverride = GOOGLE_GEMINI_DEFAULT_MODEL;
      await noteAgentModel(GOOGLE_GEMINI_DEFAULT_MODEL);
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "zai-api-key") {
    let hasCredential = false;
    const explicitToken = tokenProvider === "zai" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setZaiApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    const envKey = resolveEnvApiKey("zai");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing ZAI_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setZaiApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter Z.AI API key",
        validate: validateApiKeyInput,
      });
      await setZaiApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "zai:default",
      provider: "zai",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: ZAI_DEFAULT_MODEL_REF,
        applyDefaultConfig: applyZaiConfig,
        applyProviderConfig: (config) => ({
          ...config,
          agents: {
            ...config.agents,
            defaults: {
              ...config.agents?.defaults,
              models: {
                ...config.agents?.defaults?.models,
                [ZAI_DEFAULT_MODEL_REF]: {
                  ...config.agents?.defaults?.models?.[ZAI_DEFAULT_MODEL_REF],
                  alias: config.agents?.defaults?.models?.[ZAI_DEFAULT_MODEL_REF]?.alias ?? "GLM",
                },
              },
            },
          },
        }),
        noteDefault: ZAI_DEFAULT_MODEL_REF,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "synthetic-api-key") {
    const explicitToken =
      tokenProvider === "synthetic" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setSyntheticApiKey(explicitToken, params.agentDir);
    } else {
      const key = await params.prompter.text({
        message: "Enter Synthetic API key",
        validate: (value) => (value?.trim() ? undefined : "Required"),
      });
      await setSyntheticApiKey(String(key).trim(), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "synthetic:default",
      provider: "synthetic",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: SYNTHETIC_DEFAULT_MODEL_REF,
        applyDefaultConfig: applySyntheticConfig,
        applyProviderConfig: applySyntheticProviderConfig,
        noteDefault: SYNTHETIC_DEFAULT_MODEL_REF,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  if (authChoice === "opencode-zen") {
    let hasCredential = false;
    const explicitToken =
      tokenProvider === "opencode" ? normalizeApiKeyInput(tokenValue ?? "") : "";
    if (explicitToken) {
      await setOpencodeZenApiKey(explicitToken, params.agentDir);
      hasCredential = true;
    }
    if (!hasCredential) {
      await params.prompter.note(
        [
          "OpenCode Zen provides access to Claude, GPT, Gemini, and more models.",
          "Get your API key at: https://opencode.ai/auth",
          "Requires an active OpenCode Zen subscription.",
        ].join("\n"),
        "OpenCode Zen",
      );
    }
    const envKey = resolveEnvApiKey("opencode");
    if (!hasCredential && envKey) {
      const useExisting = await params.prompter.confirm({
        message: `Use existing OPENCODE_API_KEY (${envKey.source}, ${formatApiKeyPreview(envKey.apiKey)})?`,
        initialValue: true,
      });
      if (useExisting) {
        await setOpencodeZenApiKey(envKey.apiKey, params.agentDir);
        hasCredential = true;
      }
    }
    if (!hasCredential) {
      const key = await params.prompter.text({
        message: "Enter OpenCode Zen API key",
        validate: validateApiKeyInput,
      });
      await setOpencodeZenApiKey(normalizeApiKeyInput(String(key)), params.agentDir);
    }
    nextConfig = applyAuthProfileConfig(nextConfig, {
      profileId: "opencode:default",
      provider: "opencode",
      mode: "api_key",
    });
    {
      const applied = await applyDefaultModelChoice({
        config: nextConfig,
        setDefaultModel: params.setDefaultModel,
        defaultModel: OPENCODE_ZEN_DEFAULT_MODEL,
        applyDefaultConfig: applyOpencodeZenConfig,
        applyProviderConfig: applyOpencodeZenProviderConfig,
        noteDefault: OPENCODE_ZEN_DEFAULT_MODEL,
        noteAgentModel,
        prompter: params.prompter,
      });
      nextConfig = applied.config;
      agentModelOverride = applied.agentModelOverride ?? agentModelOverride;
    }
    return { config: nextConfig, agentModelOverride };
  }

  return null;
}
