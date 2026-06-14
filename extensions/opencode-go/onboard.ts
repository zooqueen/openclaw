// Opencode Go setup module handles plugin onboarding behavior.
import {
  applyAgentDefaultModelPrimary,
  applyProviderConfigWithModelCatalog,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/provider-onboard";
import { OPENCODE_GO_OPENAI_BASE_URL, OPENCODE_GO_MODELS } from "./provider-catalog";

export const OPENCODE_GO_DEFAULT_MODEL_REF = "opencode-go/kimi-k2.6";

export function applyOpencodeGoProviderConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyProviderConfigWithModelCatalog(cfg, {
    agentModels: {
      ...cfg.agents?.defaults?.models,
    },
    providerId: "opencode-go",
    api: "openai-completions",
    baseUrl: OPENCODE_GO_OPENAI_BASE_URL,
    catalogModels: OPENCODE_GO_MODELS,
  });
}

export function applyOpencodeGoConfig(cfg: OpenClawConfig): OpenClawConfig {
  return applyAgentDefaultModelPrimary(
    applyOpencodeGoProviderConfig(cfg),
    OPENCODE_GO_DEFAULT_MODEL_REF,
  );
}
