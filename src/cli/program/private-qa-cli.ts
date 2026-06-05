// Experimental QA CLI loader, enabled by explicit env opt-in.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { resolveOpenClawPackageRootSync } from "../../infra/openclaw-root.js";

const QA_LAB_DIST_RELATIVE_PATH = path.join("dist", "plugin-sdk", "qa-lab.js");

/** Return true when experimental QA CLI routes should be exposed. */
export function isExperimentalQaCliEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI === "1";
}

function resolveQaLabModuleSpecifier(params?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
  resolvePackageRootSync?: typeof resolveOpenClawPackageRootSync;
  existsSync?: typeof fs.existsSync;
}): string | null {
  const env = params?.env ?? process.env;
  if (!isExperimentalQaCliEnabled(env)) {
    return null;
  }
  const resolvePackageRootSync = params?.resolvePackageRootSync ?? resolveOpenClawPackageRootSync;
  const packageRoot = resolvePackageRootSync({
    argv1: params?.argv1 ?? process.argv[1],
    cwd: params?.cwd ?? process.cwd(),
    moduleUrl: params?.moduleUrl ?? import.meta.url,
  });
  if (!packageRoot) {
    return null;
  }
  const existsSync = params?.existsSync ?? fs.existsSync;
  const modulePath = path.join(packageRoot, QA_LAB_DIST_RELATIVE_PATH);
  if (!existsSync(modulePath)) {
    return null;
  }
  return pathToFileURL(modulePath).href;
}

async function dynamicImportExperimentalQaCliModule(
  specifier: string,
): Promise<Record<string, unknown>> {
  return (await import(specifier)) as Record<string, unknown>;
}

/** Load the experimental QA module or throw a user-facing availability error. */
export function loadExperimentalQaCliModule(params?: {
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  argv1?: string;
  moduleUrl?: string;
  resolvePackageRootSync?: typeof resolveOpenClawPackageRootSync;
  existsSync?: typeof fs.existsSync;
  importModule?: (specifier: string) => Promise<Record<string, unknown>>;
}): Promise<Record<string, unknown>> {
  const specifier = resolveQaLabModuleSpecifier(params);
  if (!specifier) {
    throw new Error(
      "Experimental QA CLI requires OPENCLAW_ENABLE_EXPERIMENTAL_QA_CLI=1 and a bundled QA Lab CLI module.",
    );
  }
  return (params?.importModule ?? dynamicImportExperimentalQaCliModule)(specifier);
}
