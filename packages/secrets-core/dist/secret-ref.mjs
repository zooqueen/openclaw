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
function isValidEnvSecretRefId(value) {
	return ENV_SECRET_REF_ID_RE.test(value);
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
function resolveSecretInputRef(params) {
	const explicitRef = coerceSecretRef(params.refValue, params.defaults);
	const inlineRef = explicitRef ? null : coerceSecretRef(params.value, params.defaults);
	return {
		explicitRef,
		inlineRef,
		ref: explicitRef ?? inlineRef
	};
}
//#endregion
export { DEFAULT_SECRET_PROVIDER_ALIAS, ENV_SECRET_REF_ID_RE, LEGACY_DOUBLE_UNDERSCORE_ENV_MARKER_PREFIX, LEGACY_SECRETREF_ENV_MARKER_PREFIX, coerceSecretRef, isSecretRef, isValidEnvSecretRefId, parseEnvTemplateSecretRef, parseLegacySecretRefEnvMarker, resolveSecretInputRef };
