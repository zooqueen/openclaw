//#region packages/secrets-core/src/secret-ref.d.ts
type SecretRefSource = "env" | "file" | "exec";
/**
 * Stable identifier for a secret in a configured source.
 * Examples:
 * - env source: provider "default", id "OPENAI_API_KEY"
 * - file source: provider "mounted-json", id "/providers/openai/apiKey"
 * - exec source: provider "vault", id "openai/api-key"
 */
type SecretRef = {
  source: SecretRefSource;
  provider: string;
  id: string;
};
type SecretInput = string | SecretRef;
type SecretDefaults = {
  env?: string;
  file?: string;
  exec?: string;
};
declare const DEFAULT_SECRET_PROVIDER_ALIAS = "default";
declare const ENV_SECRET_REF_ID_RE: RegExp;
declare const LEGACY_SECRETREF_ENV_MARKER_PREFIX = "secretref-env:";
declare const LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX = "__env__:";
declare function isValidEnvSecretRefId(value: string): boolean;
declare function isSecretRef(value: unknown): value is SecretRef;
declare function parseEnvTemplateSecretRef(value: unknown, provider?: string): SecretRef | null;
declare function parseLegacySecretRefEnvMarker(value: unknown, provider?: string): SecretRef | null;
declare function coerceSecretRef(value: unknown, defaults?: SecretDefaults): SecretRef | null;
declare function resolveSecretInputRef(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
}): {
  explicitRef: SecretRef | null;
  inlineRef: SecretRef | null;
  ref: SecretRef | null;
};
//#endregion
export { DEFAULT_SECRET_PROVIDER_ALIAS, ENV_SECRET_REF_ID_RE, LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX, LEGACY_SECRETREF_ENV_MARKER_PREFIX, SecretDefaults, SecretInput, SecretRef, SecretRefSource, coerceSecretRef, isSecretRef, isValidEnvSecretRefId, parseEnvTemplateSecretRef, parseLegacySecretRefEnvMarker, resolveSecretInputRef };