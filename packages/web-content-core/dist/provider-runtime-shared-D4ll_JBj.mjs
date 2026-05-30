//#region packages/secrets-core/src/secret-ref.ts
const DEFAULT_SECRET_PROVIDER_ALIAS = "default";
const ENV_SECRET_REF_ID_RE = /^[A-Z][A-Z0-9_]{0,127}$/;
const LEGACY_SECRETREF_ENV_MARKER_PREFIX = "secretref-env:";
const LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX = "__env__:";
const ENV_SECRET_TEMPLATE_RE = /^\$\{([A-Z][A-Z0-9_]{0,127})\}$/;
const ENV_SECRET_SHORTHAND_RE = /^\$([A-Z][A-Z0-9_]{0,127})$/;
const SECRET_REF_SOURCES = new Set([
	"env",
	"file",
	"exec"
]);
function isRecord(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hasSecretRefSource(value) {
	return typeof value === "string" && SECRET_REF_SOURCES.has(value);
}
function hasNonEmptyString(value) {
	return typeof value === "string" && value.trim().length > 0;
}
function isSecretRef(value) {
	if (!isRecord(value)) return false;
	if (Object.keys(value).length !== 3) return false;
	return hasSecretRefSource(value.source) && hasNonEmptyString(value.provider) && hasNonEmptyString(value.id);
}
function isLegacySecretRefWithoutProvider(value) {
	if (!isRecord(value)) return false;
	return hasSecretRefSource(value.source) && hasNonEmptyString(value.id) && value.provider === void 0;
}
function parseEnvTemplateSecretRef(value, provider = DEFAULT_SECRET_PROVIDER_ALIAS) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	const match = ENV_SECRET_TEMPLATE_RE.exec(trimmed) ?? ENV_SECRET_SHORTHAND_RE.exec(trimmed);
	if (!match) return null;
	return {
		source: "env",
		provider: provider.trim() || "default",
		id: match[1]
	};
}
function parseLegacySecretRefEnvMarker(value, provider = DEFAULT_SECRET_PROVIDER_ALIAS) {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	const prefix = trimmed.startsWith("secretref-env:") ? LEGACY_SECRETREF_ENV_MARKER_PREFIX : trimmed.startsWith("__env__:") ? LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX : void 0;
	if (!prefix) return null;
	const id = trimmed.slice(prefix.length);
	if (!ENV_SECRET_REF_ID_RE.test(id)) return null;
	return {
		source: "env",
		provider: provider.trim() || "default",
		id
	};
}
function coerceSecretRef(value, defaults) {
	if (isSecretRef(value)) return value;
	const legacyEnvMarker = parseLegacySecretRefEnvMarker(value, defaults?.env);
	if (legacyEnvMarker) return legacyEnvMarker;
	if (isLegacySecretRefWithoutProvider(value)) {
		const provider = value.source === "env" ? defaults?.env ?? "default" : value.source === "file" ? defaults?.file ?? "default" : defaults?.exec ?? "default";
		return {
			source: value.source,
			provider,
			id: value.id
		};
	}
	const envTemplate = parseEnvTemplateSecretRef(value, defaults?.env);
	if (envTemplate) return envTemplate;
	return null;
}
//#endregion
//#region packages/secrets-core/src/secret-input.ts
/**
* Normalize copy/pasted credentials for HTTP/auth use.
*
* Line breaks embedded in API keys are common paste artifacts, and non-Latin1
* rich-text characters can crash header construction before auth fails.
* Preserve ordinary internal spaces for values such as `Bearer <token>`.
*/
function normalizeSecretInput(value) {
	if (typeof value !== "string") return "";
	const collapsed = value.replace(/[\r\n\u2028\u2029]+/g, "");
	let latin1Only = "";
	for (const char of collapsed) {
		const codePoint = char.codePointAt(0);
		if (typeof codePoint === "number" && codePoint <= 255) latin1Only += char;
	}
	return latin1Only.trim();
}
function normalizeSecretInputString(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
//#endregion
//#region packages/web-content-core/src/provider-runtime-shared.ts
function resolveWebProviderConfig(cfg, kind) {
	const webConfig = cfg?.tools?.web;
	if (!webConfig || typeof webConfig !== "object") return;
	const toolConfig = webConfig[kind];
	if (!toolConfig || typeof toolConfig !== "object") return;
	return toolConfig;
}
function readWebProviderEnvValue(envVars, processEnv = process.env) {
	for (const envVar of envVars) {
		const value = normalizeSecretInput(processEnv[envVar]);
		if (value) return value;
	}
}
function providerRequiresCredential(provider) {
	return provider.requiresCredential !== false;
}
function hasWebProviderEntryCredential(params) {
	if (!providerRequiresCredential(params.provider)) return true;
	const rawValue = params.resolveRawValue({
		provider: params.provider,
		config: params.config,
		toolConfig: params.toolConfig
	});
	const configuredRef = coerceSecretRef(rawValue);
	if (configuredRef && configuredRef.source !== "env") return true;
	if (normalizeSecretInput(normalizeSecretInputString(rawValue))) return true;
	if (params.provider.authProviderId && params.resolveProviderAuthValue?.(params.provider.authProviderId)) return true;
	if (params.resolveEnvValue({
		provider: params.provider,
		configuredEnvVarId: configuredRef?.source === "env" ? configuredRef.id : void 0
	})) return true;
	const fallbackRawValue = params.resolveFallbackRawValue?.({
		provider: params.provider,
		config: params.config,
		toolConfig: params.toolConfig
	});
	const fallbackRef = coerceSecretRef(fallbackRawValue);
	if (fallbackRef && fallbackRef.source !== "env") return true;
	if (normalizeSecretInput(normalizeSecretInputString(fallbackRawValue))) return true;
	return Boolean(fallbackRef?.source === "env" ? params.resolveEnvValue({
		provider: params.provider,
		configuredEnvVarId: fallbackRef.id
	}) : void 0);
}
function resolveWebProviderDefinition(params) {
	if (!params.resolveEnabled({
		toolConfig: params.toolConfig,
		sandboxed: params.sandboxed
	})) return null;
	const providers = params.providers.filter(Boolean);
	if (providers.length === 0) return null;
	const autoProviderId = params.resolveAutoProviderId({
		config: params.config,
		toolConfig: params.toolConfig,
		providers
	});
	const providerId = params.providerId ?? params.runtimeMetadata?.selectedProvider ?? autoProviderId;
	if (!providerId) return null;
	const provider = providers.find((entry) => entry.id === providerId) ?? providers.find((entry) => entry.id === params.resolveFallbackProviderId?.({
		config: params.config,
		toolConfig: params.toolConfig,
		providers,
		providerId
	}));
	if (!provider) return null;
	const definition = params.createTool({
		provider,
		config: params.config,
		toolConfig: params.toolConfig,
		runtimeMetadata: params.runtimeMetadata
	});
	if (!definition) return null;
	return {
		provider,
		definition
	};
}
//#endregion
export { resolveWebProviderDefinition as a, resolveWebProviderConfig as i, providerRequiresCredential as n, readWebProviderEnvValue as r, hasWebProviderEntryCredential as t };
