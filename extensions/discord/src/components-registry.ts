import { resolveGlobalMap } from "openclaw/plugin-sdk/global-singleton";
import { resolvePluginConfigObject } from "openclaw/plugin-sdk/plugin-config-runtime";
import type { DiscordComponentEntry, DiscordModalEntry } from "./components.js";
import type { OpenClawConfig } from "./runtime-api.js";
import { getOptionalDiscordRuntime } from "./runtime.js";

const DEFAULT_COMPONENT_TTL_MS = 30 * 60 * 1000;
const PERSISTENT_COMPONENT_NAMESPACE = "discord.components";
const PERSISTENT_MODAL_NAMESPACE = "discord.modals";
const PERSISTENT_COMPONENT_MAX_ENTRIES = 500;
const PERSISTENT_MODAL_MAX_ENTRIES = 500;
const DISCORD_COMPONENT_ENTRIES_KEY = Symbol.for("openclaw.discord.componentEntries");
const DISCORD_MODAL_ENTRIES_KEY = Symbol.for("openclaw.discord.modalEntries");

type PersistedDiscordComponentEntry = {
  version: 1;
  entry: DiscordComponentEntry;
};

type PersistedDiscordModalEntry = {
  version: 1;
  entry: DiscordModalEntry;
};

type DiscordPersistentStore<T> = {
  register(key: string, value: T, opts?: { ttlMs?: number }): Promise<void>;
  lookup(key: string): Promise<T | undefined>;
  consume(key: string): Promise<T | undefined>;
  delete(key: string): Promise<boolean>;
};

type DiscordComponentStore = DiscordPersistentStore<PersistedDiscordComponentEntry>;

type DiscordModalStore = DiscordPersistentStore<PersistedDiscordModalEntry>;

let componentEntries: Map<string, DiscordComponentEntry> | undefined;
let modalEntries: Map<string, DiscordModalEntry> | undefined;
let persistentComponentStore: DiscordComponentStore | undefined;
let persistentModalStore: DiscordModalStore | undefined;

function getComponentEntries(): Map<string, DiscordComponentEntry> {
  componentEntries ??= resolveGlobalMap<string, DiscordComponentEntry>(
    DISCORD_COMPONENT_ENTRIES_KEY,
  );
  return componentEntries;
}

function getModalEntries(): Map<string, DiscordModalEntry> {
  modalEntries ??= resolveGlobalMap<string, DiscordModalEntry>(DISCORD_MODAL_ENTRIES_KEY);
  return modalEntries;
}

function isPersistentComponentRegistryEnabled(cfg: OpenClawConfig | undefined): boolean {
  return resolvePluginConfigObject(cfg, "discord")?.experimentalPersistentState === true;
}

function getPersistentComponentStore(): DiscordComponentStore | undefined {
  if (persistentComponentStore) {
    return persistentComponentStore;
  }
  const runtime = getOptionalDiscordRuntime();
  if (!runtime) {
    return undefined;
  }
  persistentComponentStore = runtime.state.openKeyedStore<PersistedDiscordComponentEntry>({
    namespace: PERSISTENT_COMPONENT_NAMESPACE,
    maxEntries: PERSISTENT_COMPONENT_MAX_ENTRIES,
    defaultTtlMs: DEFAULT_COMPONENT_TTL_MS,
  });
  return persistentComponentStore;
}

function getPersistentModalStore(): DiscordModalStore | undefined {
  if (persistentModalStore) {
    return persistentModalStore;
  }
  const runtime = getOptionalDiscordRuntime();
  if (!runtime) {
    return undefined;
  }
  persistentModalStore = runtime.state.openKeyedStore<PersistedDiscordModalEntry>({
    namespace: PERSISTENT_MODAL_NAMESPACE,
    maxEntries: PERSISTENT_MODAL_MAX_ENTRIES,
    defaultTtlMs: DEFAULT_COMPONENT_TTL_MS,
  });
  return persistentModalStore;
}

function reportPersistentComponentRegistryError(error: unknown): void {
  try {
    getOptionalDiscordRuntime()
      ?.logging.getChildLogger({ plugin: "discord", feature: "component-registry-state" })
      .warn("Discord persistent component registry state failed", { error: String(error) });
  } catch {
    // Best effort only: persistent state must never break Discord interactions.
  }
}

function isExpired(entry: { expiresAt?: number }, now: number) {
  return typeof entry.expiresAt === "number" && entry.expiresAt <= now;
}

function normalizeEntryTimestamps<T extends { createdAt?: number; expiresAt?: number }>(
  entry: T,
  now: number,
  ttlMs: number,
): T {
  const createdAt = entry.createdAt ?? now;
  const expiresAt = entry.expiresAt ?? createdAt + ttlMs;
  return { ...entry, createdAt, expiresAt };
}

function registerEntries<
  T extends { id: string; messageId?: string; createdAt?: number; expiresAt?: number },
>(
  entries: T[],
  store: Map<string, T>,
  params: { now: number; ttlMs: number; messageId?: string },
): T[] {
  const normalizedEntries: T[] = [];
  for (const entry of entries) {
    const normalized = normalizeEntryTimestamps(
      { ...entry, messageId: params.messageId ?? entry.messageId },
      params.now,
      params.ttlMs,
    );
    store.set(entry.id, normalized);
    normalizedEntries.push(normalized);
  }
  return normalizedEntries;
}

function resolveEntry<T extends { expiresAt?: number }>(
  store: Map<string, T>,
  params: { id: string; consume?: boolean },
): T | null {
  const entry = store.get(params.id);
  if (!entry) {
    return null;
  }
  const now = Date.now();
  if (isExpired(entry, now)) {
    store.delete(params.id);
    return null;
  }
  if (params.consume !== false) {
    store.delete(params.id);
  }
  return entry;
}

function readPersistedComponentEntry(value: unknown): DiscordComponentEntry | null {
  const persisted = value as PersistedDiscordComponentEntry | undefined;
  if (persisted?.version !== 1 || !persisted.entry || typeof persisted.entry.id !== "string") {
    return null;
  }
  return persisted.entry;
}

function readPersistedModalEntry(value: unknown): DiscordModalEntry | null {
  const persisted = value as PersistedDiscordModalEntry | undefined;
  if (persisted?.version !== 1 || !persisted.entry || typeof persisted.entry.id !== "string") {
    return null;
  }
  return persisted.entry;
}

function registerPersistentEntries(params: {
  cfg?: OpenClawConfig;
  entries: DiscordComponentEntry[];
  modals: DiscordModalEntry[];
  ttlMs: number;
}): void {
  if (!isPersistentComponentRegistryEnabled(params.cfg)) {
    return;
  }
  let componentStore: DiscordComponentStore | undefined;
  let modalStore: DiscordModalStore | undefined;
  try {
    componentStore = getPersistentComponentStore();
    modalStore = getPersistentModalStore();
  } catch (error) {
    reportPersistentComponentRegistryError(error);
    return;
  }
  if (componentStore) {
    for (const entry of params.entries) {
      void componentStore
        .register(entry.id, { version: 1, entry }, { ttlMs: params.ttlMs })
        .catch(reportPersistentComponentRegistryError);
    }
  }
  if (modalStore) {
    for (const entry of params.modals) {
      void modalStore
        .register(entry.id, { version: 1, entry }, { ttlMs: params.ttlMs })
        .catch(reportPersistentComponentRegistryError);
    }
  }
}

function deletePersistentEntry(params: {
  cfg?: OpenClawConfig;
  id: string;
  openStore: () => DiscordComponentStore | DiscordModalStore | undefined;
}): void {
  if (!isPersistentComponentRegistryEnabled(params.cfg)) {
    return;
  }
  let store: DiscordComponentStore | DiscordModalStore | undefined;
  try {
    store = params.openStore();
  } catch (error) {
    reportPersistentComponentRegistryError(error);
    return;
  }
  if (!store) {
    return;
  }
  void store.delete(params.id).catch(reportPersistentComponentRegistryError);
}

async function resolvePersistentEntry<T>(params: {
  cfg?: OpenClawConfig;
  id: string;
  consume?: boolean;
  openStore: () => DiscordComponentStore | DiscordModalStore | undefined;
  read: (value: unknown) => T | null;
}): Promise<T | null> {
  if (!isPersistentComponentRegistryEnabled(params.cfg)) {
    return null;
  }
  let store: DiscordComponentStore | DiscordModalStore | undefined;
  try {
    store = params.openStore();
  } catch (error) {
    reportPersistentComponentRegistryError(error);
    return null;
  }
  if (!store) {
    return null;
  }
  try {
    const value =
      params.consume === false ? await store.lookup(params.id) : await store.consume(params.id);
    return params.read(value);
  } catch (error) {
    reportPersistentComponentRegistryError(error);
    return null;
  }
}

export function registerDiscordComponentEntries(params: {
  entries: DiscordComponentEntry[];
  modals: DiscordModalEntry[];
  ttlMs?: number;
  messageId?: string;
  cfg?: OpenClawConfig;
}): void {
  const now = Date.now();
  const ttlMs = params.ttlMs ?? DEFAULT_COMPONENT_TTL_MS;
  const normalizedEntries = registerEntries(params.entries, getComponentEntries(), {
    now,
    ttlMs,
    messageId: params.messageId,
  });
  const normalizedModals = registerEntries(params.modals, getModalEntries(), {
    now,
    ttlMs,
    messageId: params.messageId,
  });
  registerPersistentEntries({
    cfg: params.cfg,
    entries: normalizedEntries,
    modals: normalizedModals,
    ttlMs,
  });
}

export function resolveDiscordComponentEntry(params: {
  id: string;
  consume?: boolean;
}): DiscordComponentEntry | null {
  return resolveEntry(getComponentEntries(), params);
}

export async function resolveDiscordComponentEntryForConfig(params: {
  cfg?: OpenClawConfig;
  id: string;
  consume?: boolean;
}): Promise<DiscordComponentEntry | null> {
  const inMemory = resolveDiscordComponentEntry(params);
  if (inMemory) {
    if (params.consume !== false) {
      deletePersistentEntry({ ...params, openStore: getPersistentComponentStore });
    }
    return inMemory;
  }
  return await resolvePersistentEntry({
    ...params,
    openStore: getPersistentComponentStore,
    read: readPersistedComponentEntry,
  });
}

export function resolveDiscordModalEntry(params: {
  id: string;
  consume?: boolean;
}): DiscordModalEntry | null {
  return resolveEntry(getModalEntries(), params);
}

export async function resolveDiscordModalEntryForConfig(params: {
  cfg?: OpenClawConfig;
  id: string;
  consume?: boolean;
}): Promise<DiscordModalEntry | null> {
  const inMemory = resolveDiscordModalEntry(params);
  if (inMemory) {
    if (params.consume !== false) {
      deletePersistentEntry({ ...params, openStore: getPersistentModalStore });
    }
    return inMemory;
  }
  return await resolvePersistentEntry({
    ...params,
    openStore: getPersistentModalStore,
    read: readPersistedModalEntry,
  });
}

export function clearDiscordComponentEntries(): void {
  getComponentEntries().clear();
  getModalEntries().clear();
}
