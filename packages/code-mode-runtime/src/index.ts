import path from "node:path";
import { fileURLToPath } from "node:url";

export type {
  CodeModeBridgeMethod,
  CodeModeFailureCode,
  CodeModePendingBridgeRequest,
  CodeModeRuntimeConfig,
  CodeModeSettledBridgeRequest,
  CodeModeWorkerInput,
  CodeModeWorkerResult,
} from "./types.js";

export function resolveCodeModeRuntimeWorkerUrl(currentModuleUrl = import.meta.url): URL {
  const currentPath = fileURLToPath(currentModuleUrl);
  const extension = path.extname(currentPath) || ".js";
  return new URL(`./worker${extension}`, currentModuleUrl);
}
