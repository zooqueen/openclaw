export {
  DEFAULT_SECRET_PROVIDER_ALIAS,
  ENV_SECRET_REF_ID_RE,
  LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX,
  LEGACY_SECRETREF_ENV_MARKER_PREFIX,
  assertSecretInputResolved,
  coerceSecretRef,
  hasConfiguredSecretInput,
  isSecretRef,
  isValidEnvSecretRefId,
  normalizeResolvedSecretInputString,
  normalizeSecretInput,
  normalizeSecretInputString,
  parseEnvTemplateSecretRef,
  parseLegacySecretRefEnvMarker,
  resolveSecretInputRef,
  resolveSecretInputString,
} from "../../packages/secrets-core/src/index.js";
export type {
  SecretInput,
  SecretInputStringResolution,
  SecretInputStringResolutionMode,
  SecretRef,
  SecretRefSource,
} from "../../packages/secrets-core/src/index.js";

export type EnvSecretProviderConfig = {
  source: "env";
  /** Optional env var allowlist (exact names). */
  allowlist?: string[];
};

export type FileSecretProviderMode = "singleValue" | "json"; // pragma: allowlist secret

export type FileSecretProviderConfig = {
  source: "file";
  path: string;
  mode?: FileSecretProviderMode;
  timeoutMs?: number;
  maxBytes?: number;
  allowInsecurePath?: boolean;
};

export type ManualExecSecretProviderConfig = {
  source: "exec";
  command: string;
  args?: string[];
  timeoutMs?: number;
  noOutputTimeoutMs?: number;
  maxOutputBytes?: number;
  jsonOnly?: boolean;
  env?: Record<string, string>;
  passEnv?: string[];
  trustedDirs?: string[];
  allowInsecurePath?: boolean;
  allowSymlinkCommand?: boolean;
};

export type PluginIntegrationSecretProviderConfig = {
  source: "exec";
  pluginIntegration: {
    pluginId: string;
    integrationId: string;
  };
};

export type ExecSecretProviderConfig =
  | ManualExecSecretProviderConfig
  | PluginIntegrationSecretProviderConfig;

export type SecretProviderConfig =
  | EnvSecretProviderConfig
  | FileSecretProviderConfig
  | ExecSecretProviderConfig;

export type SecretsConfig = {
  providers?: Record<string, SecretProviderConfig>;
  defaults?: {
    env?: string;
    file?: string;
    exec?: string;
  };
  resolution?: {
    maxProviderConcurrency?: number;
    maxRefsPerProvider?: number;
    maxBatchBytes?: number;
  };
};
