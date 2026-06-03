import { normalizeOptionalLowercaseString } from "@openclaw/normalization-core/string-coerce";

export function normalizeCapabilityProviderId(providerId: string | undefined): string | undefined {
  return normalizeOptionalLowercaseString(providerId);
}

export function buildCapabilityProviderMaps<T extends { id: string; aliases?: readonly string[] }>(
  providers: readonly T[],
  normalizeId: (
    providerId: string | undefined,
  ) => string | undefined = normalizeCapabilityProviderId,
): {
  canonical: Map<string, T>;
  aliases: Map<string, T>;
} {
  const canonical = new Map<string, T>();
  const aliases = new Map<string, T>();

  for (const provider of providers) {
    let id: string | undefined;
    let rawAliases: readonly string[] | undefined;
    try {
      id = normalizeId(provider.id);
    } catch {
      continue;
    }
    try {
      rawAliases = provider.aliases;
    } catch {
      rawAliases = undefined;
    }
    if (!id) {
      continue;
    }
    canonical.set(id, provider);
    aliases.set(id, provider);
    for (const alias of rawAliases ?? []) {
      const normalizedAlias = normalizeId(alias);
      if (normalizedAlias) {
        aliases.set(normalizedAlias, provider);
      }
    }
  }

  return { canonical, aliases };
}
