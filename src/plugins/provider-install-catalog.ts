import {
  loadOpenClawProviderIndex,
  type OpenClawProviderIndexProvider,
} from "../model-catalog/index.js";
import { isRecord } from "../shared/record-coerce.js";
import { normalizeOptionalString } from "../shared/string-coerce.js";
import { normalizePluginsConfig, resolveEffectiveEnableState } from "./config-state.js";
import {
  describePluginInstallSource,
  type PluginInstallSourceInfo,
} from "./install-source-info.js";
import type { PluginPackageInstall } from "./manifest.js";
import {
  getOfficialExternalPluginCatalogManifest,
  listOfficialExternalProviderCatalogEntries,
  resolveOfficialExternalPluginInstall,
  type OfficialExternalProviderAuthChoice,
} from "./official-external-plugin-catalog.js";
import type { PluginOrigin } from "./plugin-origin.types.js";
import { loadPluginRegistrySnapshot } from "./plugin-registry.js";
import {
  resolveManifestProviderAuthChoices,
  type ProviderAuthChoiceMetadata,
} from "./provider-auth-choices.js";

export type ProviderInstallCatalogEntry = ProviderAuthChoiceMetadata & {
  label: string;
  origin: PluginOrigin;
  install: PluginPackageInstall;
  installSource?: PluginInstallSourceInfo;
};

type ProviderInstallCatalogParams = {
  config?: import("../config/types.openclaw.js").OpenClawConfig;
  workspaceDir?: string;
  env?: NodeJS.ProcessEnv;
  includeUntrustedWorkspacePlugins?: boolean;
};

type PreferredInstallSource = {
  origin: PluginOrigin;
  install: PluginPackageInstall;
  packageName?: string;
};
type PreferredInstallSources = {
  installedPluginIds: ReadonlySet<string>;
  installsByPluginId: Map<string, PreferredInstallSource>;
};
type ProviderInstallCatalogChoiceFields = Pick<
  ProviderAuthChoiceMetadata,
  | "choiceHint"
  | "assistantPriority"
  | "assistantVisibility"
  | "groupId"
  | "groupLabel"
  | "groupHint"
  | "optionKey"
  | "cliFlag"
  | "cliOption"
  | "cliDescription"
  | "onboardingScopes"
>;
type ProviderIndexAuthChoice = NonNullable<OpenClawProviderIndexProvider["authChoices"]>[number];

const INSTALL_ORIGIN_PRIORITY: Readonly<Record<PluginOrigin, number>> = {
  config: 0,
  bundled: 1,
  global: 2,
  workspace: 3,
};

function isPreferredOrigin(candidate: PluginOrigin, current: PluginOrigin | undefined): boolean {
  return !current || INSTALL_ORIGIN_PRIORITY[candidate] < INSTALL_ORIGIN_PRIORITY[current];
}

function isReadableRecord(value: unknown): value is Record<string, unknown> {
  try {
    return isRecord(value);
  } catch {
    return false;
  }
}

function readRecordValue(record: unknown, key: string): unknown {
  if (!isReadableRecord(record)) {
    return undefined;
  }
  try {
    return record[key];
  } catch {
    return undefined;
  }
}

function copyArrayEntries(value: unknown): unknown[] {
  let isArray: boolean;
  try {
    isArray = Array.isArray(value);
  } catch {
    return [];
  }
  if (!isArray) {
    return [];
  }
  const arrayValue = value as readonly unknown[];
  let length: number;
  try {
    length = arrayValue.length;
  } catch {
    return [];
  }
  const entries: unknown[] = [];
  for (let index = 0; index < length; index += 1) {
    try {
      entries.push(arrayValue[index]);
    } catch {
      continue;
    }
  }
  return entries;
}

function readStringField(record: unknown, key: string): string | undefined {
  return normalizeOptionalString(readRecordValue(record, key));
}

function readBooleanField(record: unknown, key: string): boolean | undefined {
  const value = readRecordValue(record, key);
  return typeof value === "boolean" ? value : undefined;
}

function readPluginOrigin(record: unknown): PluginOrigin | undefined {
  const origin = readStringField(record, "origin");
  return origin === "config" ||
    origin === "bundled" ||
    origin === "global" ||
    origin === "workspace"
    ? origin
    : undefined;
}

function copyPluginRegistryRecords(snapshot: unknown): unknown[] {
  return copyArrayEntries(readRecordValue(snapshot, "plugins")).filter(isReadableRecord);
}

function normalizeDefaultChoice(value: unknown): PluginPackageInstall["defaultChoice"] | undefined {
  return value === "clawhub" || value === "npm" || value === "local" ? value : undefined;
}

function resolveInstallInfoFromInstallRecord(record: unknown): PluginPackageInstall | null {
  if (!record) {
    return null;
  }
  const source = readStringField(record, "source");
  const spec = readStringField(record, "spec");
  const resolvedSpec = readStringField(record, "resolvedSpec");
  const npmSpec = resolvedSpec ?? spec;
  const localPath = readStringField(record, "installPath") ?? readStringField(record, "sourcePath");
  if (source === "clawhub" && spec) {
    return {
      clawhubSpec: spec,
      defaultChoice: "clawhub",
    };
  }
  if (source === "npm" && npmSpec) {
    const integrity = readStringField(record, "integrity");
    return {
      npmSpec,
      defaultChoice: "npm",
      ...(integrity ? { expectedIntegrity: integrity } : {}),
    };
  }
  if (source === "path" && localPath) {
    return {
      localPath,
      defaultChoice: "local",
    };
  }
  return null;
}

function resolveInstallInfoFromPackageSource(params: {
  origin: PluginOrigin;
  source?: unknown;
}): PluginPackageInstall | null {
  const source = isReadableRecord(params.source) ? params.source : undefined;
  const npmValue = readRecordValue(source, "npm");
  const clawhubValue = readRecordValue(source, "clawhub");
  const localValue = readRecordValue(source, "local");
  const npm = isReadableRecord(npmValue) ? npmValue : undefined;
  const clawhub = isReadableRecord(clawhubValue) ? clawhubValue : undefined;
  const local = isReadableRecord(localValue) ? localValue : undefined;
  const npmSpec =
    params.origin === "bundled" || params.origin === "config"
      ? readStringField(npm, "spec")
      : undefined;
  const clawhubSpec =
    params.origin === "bundled" || params.origin === "config"
      ? readStringField(clawhub, "spec")
      : undefined;
  const localPath = readStringField(local, "path");
  if (!clawhubSpec && !npmSpec && !localPath) {
    return null;
  }
  const defaultChoice = normalizeDefaultChoice(readRecordValue(source, "defaultChoice"));
  const expectedIntegrity = readStringField(npm, "expectedIntegrity");
  return {
    ...(clawhubSpec ? { clawhubSpec } : {}),
    ...(npmSpec ? { npmSpec } : {}),
    ...(localPath ? { localPath } : {}),
    ...(defaultChoice
      ? { defaultChoice }
      : clawhubSpec
        ? { defaultChoice: "clawhub" as const }
        : npmSpec
          ? { defaultChoice: "npm" as const }
          : {}),
    ...(npmSpec && expectedIntegrity ? { expectedIntegrity } : {}),
  };
}

function resolveInstallInfoFromRegistryRecord(params: {
  record: unknown;
  origin: PluginOrigin;
  installRecord?: unknown;
}): PluginPackageInstall | null {
  return (
    resolveInstallInfoFromInstallRecord(params.installRecord) ??
    resolveInstallInfoFromPackageSource({
      origin: params.origin,
      source: readRecordValue(params.record, "packageInstall"),
    })
  );
}

function readProviderIndexStringField(
  provider: OpenClawProviderIndexProvider,
  field: "id" | "name",
): string | undefined {
  try {
    return normalizeOptionalString((provider as Record<string, unknown>)[field]);
  } catch {
    return undefined;
  }
}

function readProviderIndexPluginField(
  provider: OpenClawProviderIndexProvider,
  field: "id" | "package" | "install",
): unknown {
  try {
    const plugin = (provider as { plugin?: unknown }).plugin;
    if (!isReadableRecord(plugin)) {
      return undefined;
    }
    return plugin[field];
  } catch {
    return undefined;
  }
}

function readProviderIndexInstallStringField(
  install: Record<string, unknown>,
  field: "clawhubSpec" | "npmSpec" | "defaultChoice" | "minHostVersion" | "expectedIntegrity",
): string | undefined {
  try {
    return normalizeOptionalString(install[field]);
  } catch {
    return undefined;
  }
}

function readProviderIndexAuthChoices(
  provider: OpenClawProviderIndexProvider,
): ProviderIndexAuthChoice[] {
  try {
    return Array.isArray(provider.authChoices) ? [...provider.authChoices] : [];
  } catch {
    return [];
  }
}

function resolveInstallInfoFromProviderIndex(
  provider: OpenClawProviderIndexProvider,
): PluginPackageInstall | null {
  const install = readProviderIndexPluginField(provider, "install");
  if (!isReadableRecord(install)) {
    return null;
  }
  const clawhubSpec = readProviderIndexInstallStringField(install, "clawhubSpec");
  const npmSpec = readProviderIndexInstallStringField(install, "npmSpec");
  if (!clawhubSpec && !npmSpec) {
    return null;
  }
  const defaultChoice =
    normalizeDefaultChoice(readProviderIndexInstallStringField(install, "defaultChoice")) ??
    (clawhubSpec ? "clawhub" : "npm");
  const minHostVersion = readProviderIndexInstallStringField(install, "minHostVersion");
  const expectedIntegrity = readProviderIndexInstallStringField(install, "expectedIntegrity");
  return {
    ...(clawhubSpec ? { clawhubSpec } : {}),
    ...(npmSpec ? { npmSpec } : {}),
    defaultChoice,
    ...(minHostVersion ? { minHostVersion } : {}),
    ...(expectedIntegrity ? { expectedIntegrity } : {}),
  };
}

function resolvePreferredInstallsByPluginId(
  params: ProviderInstallCatalogParams,
): PreferredInstallSources {
  const preferredByPluginId = new Map<string, PreferredInstallSource>();
  const index = loadPluginRegistrySnapshot({
    config: params.config,
    workspaceDir: params.workspaceDir,
    env: params.env,
  });
  const pluginRecords = copyPluginRegistryRecords(index);
  const installedPluginIds = new Set(
    pluginRecords
      .map((record) => readStringField(record, "pluginId"))
      .filter((pluginId): pluginId is string => Boolean(pluginId)),
  );
  const normalizedConfig = normalizePluginsConfig(params.config?.plugins);
  for (const record of pluginRecords) {
    const pluginId = readStringField(record, "pluginId");
    const origin = readPluginOrigin(record);
    if (!pluginId || !origin) {
      continue;
    }
    if (
      origin === "workspace" &&
      params.includeUntrustedWorkspacePlugins === false &&
      !resolveEffectiveEnableState({
        id: pluginId,
        origin,
        config: normalizedConfig,
        rootConfig: params.config,
        enabledByDefault: readBooleanField(record, "enabledByDefault"),
      }).enabled
    ) {
      continue;
    }
    const installRecords = readRecordValue(index, "installRecords");
    const install = resolveInstallInfoFromRegistryRecord({
      record,
      origin,
      installRecord: readRecordValue(installRecords, pluginId),
    });
    if (!install) {
      continue;
    }
    const existing = preferredByPluginId.get(pluginId);
    if (!existing || isPreferredOrigin(origin, existing.origin)) {
      const packageName = readStringField(record, "packageName");
      preferredByPluginId.set(pluginId, {
        origin,
        install,
        ...(packageName ? { packageName } : {}),
      });
    }
  }
  return { installedPluginIds, installsByPluginId: preferredByPluginId };
}

function resolveProviderIndexInstallCatalogEntries(params: {
  installedPluginIds: ReadonlySet<string>;
  seenChoiceIds: ReadonlySet<string>;
}): ProviderInstallCatalogEntry[] {
  const entries: ProviderInstallCatalogEntry[] = [];
  const index = loadOpenClawProviderIndex();
  for (const provider of Object.values(index.providers)) {
    const pluginId = normalizeOptionalString(readProviderIndexPluginField(provider, "id"));
    if (!pluginId || params.installedPluginIds.has(pluginId)) {
      continue;
    }
    const install = resolveInstallInfoFromProviderIndex(provider);
    if (!install) {
      continue;
    }
    for (const choice of readProviderIndexAuthChoices(provider)) {
      if (params.seenChoiceIds.has(choice.choiceId)) {
        continue;
      }
      entries.push({
        pluginId,
        providerId: readProviderIndexStringField(provider, "id") ?? pluginId,
        methodId: choice.method,
        choiceId: choice.choiceId,
        choiceLabel: choice.choiceLabel,
        ...resolveProviderInstallCatalogChoiceFields({
          choiceHint: choice.choiceHint,
          assistantPriority: choice.assistantPriority,
          assistantVisibility: choice.assistantVisibility,
          groupId: choice.groupId,
          groupLabel: choice.groupLabel,
          groupHint: choice.groupHint,
          optionKey: choice.optionKey,
          cliFlag: choice.cliFlag,
          cliOption: choice.cliOption,
          cliDescription: choice.cliDescription,
          onboardingScopes: choice.onboardingScopes ? [...choice.onboardingScopes] : undefined,
        }),
        label: readProviderIndexStringField(provider, "name") ?? pluginId,
        origin: "bundled",
        install,
        installSource: describePluginInstallSource(install, {
          expectedPackageName: normalizeOptionalString(
            readProviderIndexPluginField(provider, "package"),
          ),
        }),
      });
    }
  }
  return entries;
}

function resolveProviderInstallCatalogChoiceFields(
  choice: ProviderInstallCatalogChoiceFields,
): Partial<ProviderInstallCatalogChoiceFields> {
  return {
    ...(choice.choiceHint ? { choiceHint: choice.choiceHint } : {}),
    ...(choice.assistantPriority !== undefined
      ? { assistantPriority: choice.assistantPriority }
      : {}),
    ...(choice.assistantVisibility ? { assistantVisibility: choice.assistantVisibility } : {}),
    ...(choice.groupId ? { groupId: choice.groupId } : {}),
    ...(choice.groupLabel ? { groupLabel: choice.groupLabel } : {}),
    ...(choice.groupHint ? { groupHint: choice.groupHint } : {}),
    ...(choice.optionKey ? { optionKey: choice.optionKey } : {}),
    ...(choice.cliFlag ? { cliFlag: choice.cliFlag } : {}),
    ...(choice.cliOption ? { cliOption: choice.cliOption } : {}),
    ...(choice.cliDescription ? { cliDescription: choice.cliDescription } : {}),
    ...(choice.onboardingScopes ? { onboardingScopes: choice.onboardingScopes } : {}),
  };
}

function isProviderFlowScope(
  value: unknown,
): value is "text-inference" | "image-generation" | "music-generation" {
  return value === "text-inference" || value === "image-generation" || value === "music-generation";
}

function normalizeProviderAuthChoiceScopes(
  scopes: OfficialExternalProviderAuthChoice["onboardingScopes"],
): ("text-inference" | "image-generation" | "music-generation")[] | undefined {
  if (!Array.isArray(scopes)) {
    return undefined;
  }
  const normalized = scopes.filter(isProviderFlowScope);
  return normalized.length > 0 ? normalized : undefined;
}

function resolveOfficialExternalProviderInstallCatalogEntries(params: {
  installedPluginIds: ReadonlySet<string>;
  seenChoiceIds: ReadonlySet<string>;
}): ProviderInstallCatalogEntry[] {
  const entries: ProviderInstallCatalogEntry[] = [];
  for (const entry of listOfficialExternalProviderCatalogEntries()) {
    const manifest = getOfficialExternalPluginCatalogManifest(entry);
    const pluginId = manifest?.plugin?.id?.trim();
    if (!manifest || !pluginId || params.installedPluginIds.has(pluginId)) {
      continue;
    }
    const install = resolveOfficialExternalPluginInstall(entry);
    if (!install) {
      continue;
    }
    for (const provider of manifest?.providers ?? []) {
      const providerId = provider.id?.trim();
      const label = provider.name?.trim() || manifest.plugin?.label?.trim() || entry.name?.trim();
      if (!providerId || !label) {
        continue;
      }
      for (const choice of provider.authChoices ?? []) {
        const methodId = choice.method?.trim();
        const choiceId = choice.choiceId?.trim();
        const choiceLabel = choice.choiceLabel?.trim();
        if (!methodId || !choiceId || !choiceLabel || params.seenChoiceIds.has(choiceId)) {
          continue;
        }
        entries.push({
          pluginId,
          providerId,
          methodId,
          choiceId,
          choiceLabel,
          ...resolveProviderInstallCatalogChoiceFields({
            choiceHint: choice.choiceHint,
            assistantPriority: choice.assistantPriority,
            assistantVisibility: choice.assistantVisibility,
            groupId: choice.groupId,
            groupLabel: choice.groupLabel,
            groupHint: choice.groupHint,
            optionKey: choice.optionKey,
            cliFlag: choice.cliFlag,
            cliOption: choice.cliOption,
            cliDescription: choice.cliDescription,
            onboardingScopes: normalizeProviderAuthChoiceScopes(choice.onboardingScopes),
          }),
          label,
          origin: "bundled",
          install,
          installSource: describePluginInstallSource(install, {
            expectedPackageName: entry.name,
          }),
        });
      }
    }
  }
  return entries;
}

export function resolveProviderInstallCatalogEntries(
  params?: ProviderInstallCatalogParams,
): ProviderInstallCatalogEntry[] {
  const installParams = params ?? {};
  const { installedPluginIds, installsByPluginId } =
    resolvePreferredInstallsByPluginId(installParams);
  const manifestEntries = resolveManifestProviderAuthChoices(params)
    .flatMap((choice) => {
      const install = installsByPluginId.get(choice.pluginId);
      if (!install) {
        return [];
      }
      return [
        {
          ...choice,
          label: choice.groupLabel ?? choice.choiceLabel,
          origin: install.origin,
          install: install.install,
          installSource: describePluginInstallSource(install.install, {
            expectedPackageName: install.packageName,
          }),
        } satisfies ProviderInstallCatalogEntry,
      ];
    })
    .toSorted((left, right) => left.choiceLabel.localeCompare(right.choiceLabel));
  const seenChoiceIds = new Set(manifestEntries.map((entry) => entry.choiceId));
  const officialEntries = resolveOfficialExternalProviderInstallCatalogEntries({
    installedPluginIds,
    seenChoiceIds,
  });
  for (const entry of officialEntries) {
    seenChoiceIds.add(entry.choiceId);
  }
  const indexEntries = resolveProviderIndexInstallCatalogEntries({
    installedPluginIds,
    seenChoiceIds,
  });
  return [...manifestEntries, ...officialEntries, ...indexEntries].toSorted((left, right) =>
    left.choiceLabel.localeCompare(right.choiceLabel),
  );
}

export function resolveProviderInstallCatalogEntry(
  choiceId: string,
  params?: ProviderInstallCatalogParams,
): ProviderInstallCatalogEntry | undefined {
  const normalizedChoiceId = choiceId.trim();
  if (!normalizedChoiceId) {
    return undefined;
  }
  return resolveProviderInstallCatalogEntries(params).find(
    (entry) => entry.choiceId === normalizedChoiceId,
  );
}
