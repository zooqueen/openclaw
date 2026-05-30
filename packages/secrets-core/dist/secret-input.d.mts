import { SecretDefaults, SecretRef } from "./secret-ref.mjs";

//#region packages/secrets-core/src/secret-input.d.ts
type SecretInputStringResolutionMode = "strict" | "inspect";
type SecretInputStringResolution = {
  status: "available";
  value: string;
  ref: null;
} | {
  status: "configured_unavailable";
  value: undefined;
  ref: SecretRef;
} | {
  status: "missing";
  value: undefined;
  ref: null;
};
/**
 * Normalize copy/pasted credentials for HTTP/auth use.
 *
 * Line breaks embedded in API keys are common paste artifacts, and non-Latin1
 * rich-text characters can crash header construction before auth fails.
 * Preserve ordinary internal spaces for values such as `Bearer <token>`.
 */
declare function normalizeSecretInput(value: unknown): string;
declare function normalizeOptionalSecretInput(value: unknown): string | undefined;
declare function normalizeSecretInputString(value: unknown): string | undefined;
declare function hasConfiguredSecretInput(value: unknown, defaults?: SecretDefaults): boolean;
declare function assertSecretInputResolved(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
  path: string;
}): void;
declare function resolveSecretInputString(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
  path: string;
  mode?: SecretInputStringResolutionMode;
}): SecretInputStringResolution;
declare function normalizeResolvedSecretInputString(params: {
  value: unknown;
  refValue?: unknown;
  defaults?: SecretDefaults;
  path: string;
}): string | undefined;
//#endregion
export { SecretInputStringResolution, SecretInputStringResolutionMode, assertSecretInputResolved, hasConfiguredSecretInput, normalizeOptionalSecretInput, normalizeResolvedSecretInputString, normalizeSecretInput, normalizeSecretInputString, resolveSecretInputString };