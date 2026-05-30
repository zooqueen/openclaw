import { coerceSecretRef, resolveSecretInputRef } from "./secret-ref.mjs";
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
function normalizeOptionalSecretInput(value) {
	const normalized = normalizeSecretInput(value);
	return normalized ? normalized : void 0;
}
function normalizeSecretInputString(value) {
	if (typeof value !== "string") return;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : void 0;
}
function hasConfiguredSecretInput(value, defaults) {
	if (normalizeSecretInputString(value)) return true;
	return coerceSecretRef(value, defaults) !== null;
}
function formatSecretRefLabel(ref) {
	return `${ref.source}:${ref.provider}:${ref.id}`;
}
function createUnresolvedSecretInputError(params) {
	return /* @__PURE__ */ new Error(`${params.path}: unresolved SecretRef "${formatSecretRefLabel(params.ref)}". Resolve this command against an active gateway runtime snapshot before reading it.`);
}
function assertSecretInputResolved(params) {
	const { ref } = resolveSecretInputRef({
		value: params.value,
		refValue: params.refValue,
		defaults: params.defaults
	});
	if (!ref) return;
	throw createUnresolvedSecretInputError({
		path: params.path,
		ref
	});
}
function resolveSecretInputString(params) {
	const normalized = normalizeSecretInputString(params.value);
	if (normalized) return {
		status: "available",
		value: normalized,
		ref: null
	};
	const { ref } = resolveSecretInputRef({
		value: params.value,
		refValue: params.refValue,
		defaults: params.defaults
	});
	if (!ref) return {
		status: "missing",
		value: void 0,
		ref: null
	};
	if ((params.mode ?? "strict") === "strict") throw createUnresolvedSecretInputError({
		path: params.path,
		ref
	});
	return {
		status: "configured_unavailable",
		value: void 0,
		ref
	};
}
function normalizeResolvedSecretInputString(params) {
	const resolved = resolveSecretInputString({
		...params,
		mode: "strict"
	});
	if (resolved.status === "available") return resolved.value;
}
//#endregion
export { assertSecretInputResolved, hasConfiguredSecretInput, normalizeOptionalSecretInput, normalizeResolvedSecretInputString, normalizeSecretInput, normalizeSecretInputString, resolveSecretInputString };
