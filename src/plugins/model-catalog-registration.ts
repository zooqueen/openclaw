// Registers plugin-provided models into the model catalog.
import type {
  UnifiedModelCatalogEntry,
  UnifiedModelCatalogSource,
} from "@openclaw/model-catalog-core/model-catalog-types";
import {
  synthesizeMediaGenerationCatalogEntries,
  type MediaGenerationCatalogKind,
  type MediaGenerationCatalogProvider,
} from "../../packages/media-generation-core/src/catalog.js";
import { normalizeOptionalString } from "../../packages/normalization-core/src/string-coerce.js";
import { uniqueValues } from "../../packages/normalization-core/src/string-normalization.js";
import {
  synthesizeVoiceModelCatalogEntries,
  type VoiceModelCapabilities,
  type VoiceModelProvider,
} from "../../packages/speech-core/voice-models.js";
import { formatErrorMessage } from "../infra/errors.js";
import type { PluginDiagnostic } from "./manifest-types.js";
import { projectProviderCatalogResultToUnifiedTextRows } from "./provider-catalog-unified-text.js";
import type { PluginRecord, PluginRegistry } from "./registry-types.js";
import type {
  ProviderPlugin,
  UnifiedModelCatalogProviderContext,
  UnifiedModelCatalogProviderPlugin,
} from "./types.js";

type UnifiedModelCatalogHook = NonNullable<UnifiedModelCatalogProviderPlugin["staticCatalog"]>;

function mergeCatalogHookResults(
  source: UnifiedModelCatalogSource,
  left: readonly UnifiedModelCatalogEntry[] | null | undefined,
  right: readonly UnifiedModelCatalogEntry[] | null | undefined,
): readonly UnifiedModelCatalogEntry[] | null {
  const rows = [...(left ?? []), ...(right ?? [])];
  if (rows.length === 0) {
    return null;
  }
  const mergedRows: UnifiedModelCatalogEntry[] = [];
  for (const row of rows) {
    mergedRows.push({ ...row, source });
  }
  return mergedRows;
}

function mergeModelCatalogHooks(
  source: UnifiedModelCatalogSource,
  left: UnifiedModelCatalogHook | undefined,
  right: UnifiedModelCatalogHook | undefined,
): UnifiedModelCatalogHook | undefined {
  if (!left) {
    return right;
  }
  if (!right) {
    return left;
  }
  return async (ctx) => {
    const [leftRows, rightRows] = await Promise.all([left(ctx), right(ctx)]);
    return mergeCatalogHookResults(source, leftRows, rightRows);
  };
}

function snapshotModelCatalogProvider(params: {
  provider: UnifiedModelCatalogProviderPlugin;
  providerId: string;
  kinds: readonly UnifiedModelCatalogProviderPlugin["kinds"][number][];
}): UnifiedModelCatalogProviderPlugin {
  const { provider, providerId, kinds } = params;
  const staticCatalog = provider.staticCatalog;
  const liveCatalog = provider.liveCatalog;
  return {
    provider: providerId,
    kinds,
    ...(staticCatalog ? { staticCatalog: (ctx) => staticCatalog.call(provider, ctx) } : {}),
    ...(liveCatalog ? { liveCatalog: (ctx) => liveCatalog.call(provider, ctx) } : {}),
  };
}

/** Creates handlers that register plugin model catalog providers into a registry. */
export function createModelCatalogRegistrationHandlers(params: {
  registry: PluginRegistry;
  pushDiagnostic: (diagnostic: PluginDiagnostic) => void;
}) {
  const registerModelCatalogProvider = (
    record: PluginRecord,
    provider: UnifiedModelCatalogProviderPlugin,
  ) => {
    let providerId = "";
    let kinds: readonly UnifiedModelCatalogProviderPlugin["kinds"][number][] | undefined;
    let providerSnapshot: UnifiedModelCatalogProviderPlugin | undefined;
    try {
      const rawProviderId = provider.provider;
      const rawKinds = provider.kinds;
      providerId = normalizeOptionalString(rawProviderId) ?? "";
      kinds = Array.isArray(rawKinds) ? uniqueValues(rawKinds) : undefined;
      providerSnapshot =
        providerId && kinds && kinds.length > 0
          ? snapshotModelCatalogProvider({ provider, providerId, kinds })
          : undefined;
    } catch (error) {
      params.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `model catalog provider registration has unreadable fields: ${formatErrorMessage(error)}`,
      });
      return;
    }
    if (!providerId) {
      params.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: "model catalog provider registration missing provider",
      });
      return;
    }
    if (!kinds || kinds.length === 0 || !providerSnapshot) {
      params.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `model catalog provider "${providerId}" registration missing kinds`,
      });
      return;
    }
    const existing = params.registry.modelCatalogProviders.find(
      (entry) => entry.provider.provider === providerId && entry.pluginId !== record.id,
    );
    if (existing) {
      params.pushDiagnostic({
        level: "error",
        pluginId: record.id,
        source: record.source,
        message: `model catalog provider already registered: ${providerId} (${existing.pluginId})`,
      });
      return;
    }
    const samePluginOverlapping = params.registry.modelCatalogProviders.find(
      (entry) =>
        entry.provider.provider === providerId &&
        entry.pluginId === record.id &&
        entry.provider.kinds.some((kind) => kinds.includes(kind)),
    );
    if (samePluginOverlapping) {
      samePluginOverlapping.provider = {
        ...samePluginOverlapping.provider,
        ...providerSnapshot,
        provider: providerId,
        kinds: uniqueValues([...samePluginOverlapping.provider.kinds, ...kinds]),
        staticCatalog: mergeModelCatalogHooks(
          "static",
          samePluginOverlapping.provider.staticCatalog,
          providerSnapshot.staticCatalog,
        ),
        liveCatalog: mergeModelCatalogHooks(
          "live",
          samePluginOverlapping.provider.liveCatalog,
          providerSnapshot.liveCatalog,
        ),
      };
      return;
    }
    params.registry.modelCatalogProviders.push({
      pluginId: record.id,
      pluginName: record.name,
      provider: providerSnapshot,
      source: record.source,
      rootDir: record.rootDir,
    });
  };

  const registerSynthesizedTextModelCatalogProvider = (registration: {
    record: PluginRecord;
    provider: ProviderPlugin;
  }) => {
    if (!registration.provider.catalog && !registration.provider.staticCatalog) {
      return;
    }
    registerModelCatalogProvider(registration.record, {
      provider: registration.provider.id,
      kinds: ["text"],
      ...(registration.provider.staticCatalog
        ? {
            staticCatalog: async (ctx: UnifiedModelCatalogProviderContext) =>
              projectProviderCatalogResultToUnifiedTextRows({
                providerId: registration.provider.id,
                result: await registration.provider.staticCatalog!.run(ctx),
                source: "static",
              }),
          }
        : {}),
      ...(registration.provider.catalog
        ? {
            liveCatalog: async (ctx: UnifiedModelCatalogProviderContext) =>
              projectProviderCatalogResultToUnifiedTextRows({
                providerId: registration.provider.id,
                result: await registration.provider.catalog!.run(ctx),
                source: "live",
              }),
          }
        : {}),
    });
  };

  const registerSynthesizedMediaModelCatalogProvider = <TCapabilities>(registration: {
    record: PluginRecord;
    kind: MediaGenerationCatalogKind;
    provider: MediaGenerationCatalogProvider<TCapabilities>;
  }) => {
    registerModelCatalogProvider(registration.record, {
      provider: registration.provider.id,
      kinds: [registration.kind],
      staticCatalog: () =>
        synthesizeMediaGenerationCatalogEntries({
          kind: registration.kind,
          provider: registration.provider,
        }),
    });
  };

  const registerSynthesizedVoiceModelCatalogProvider = (registration: {
    record: PluginRecord;
    provider: VoiceModelProvider;
    capabilities: VoiceModelCapabilities;
    modes?: readonly string[];
  }) => {
    registerModelCatalogProvider(registration.record, {
      provider: registration.provider.id,
      kinds: ["voice"],
      staticCatalog: () =>
        synthesizeVoiceModelCatalogEntries({
          provider: registration.provider,
          capabilities: registration.capabilities,
          modes: registration.modes,
        }),
    });
  };

  return {
    registerModelCatalogProvider,
    registerSynthesizedTextModelCatalogProvider,
    registerSynthesizedMediaModelCatalogProvider,
    registerSynthesizedVoiceModelCatalogProvider,
  };
}
