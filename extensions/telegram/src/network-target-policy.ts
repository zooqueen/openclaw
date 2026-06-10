import { lookup as dnsLookupCb, type LookupAddress } from "node:dns";

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | LookupAddress[],
  family?: number,
) => void;

export type PinnedHostnameOverride = {
  hostname: string;
  addresses: string[];
};

export type PinnedDispatcherPolicy =
  | {
      mode: "direct";
      connect?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    }
  | {
      mode: "env-proxy";
      connect?: Record<string, unknown>;
      proxyTls?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    }
  | {
      mode: "explicit-proxy";
      proxyUrl: string;
      allowPrivateProxy?: boolean;
      proxyTls?: Record<string, unknown>;
      pinnedHostname?: PinnedHostnameOverride;
    };

function normalizeHostname(hostname: string): string {
  const normalized = hostname.trim().toLowerCase().replace(/\.+$/u, "");
  return normalized.startsWith("[") && normalized.endsWith("]")
    ? normalized.slice(1, -1)
    : normalized;
}

export function createPinnedLookup(params: {
  hostname: string;
  addresses: string[];
  fallback?: typeof dnsLookupCb;
}): typeof dnsLookupCb {
  const normalizedHost = normalizeHostname(params.hostname);
  if (params.addresses.length === 0) {
    throw new Error(`Pinned lookup requires at least one address for ${params.hostname}`);
  }
  const fallback = params.fallback ?? dnsLookupCb;
  const records = params.addresses.map((address) => ({
    address,
    family: address.includes(":") ? 6 : 4,
  }));
  const ipv4Records = records.filter((entry) => entry.family === 4);
  const automaticRecords = ipv4Records.length > 0 ? ipv4Records : records;
  let index = 0;
  return ((host: string, options?: unknown, callback?: unknown) => {
    const cb: LookupCallback =
      typeof options === "function" ? (options as LookupCallback) : (callback as LookupCallback);
    if (!cb) {
      return;
    }
    if (normalizeHostname(host) !== normalizedHost) {
      return typeof options === "function" || options === undefined
        ? (fallback as unknown as (hostname: string, callback: LookupCallback) => void)(host, cb)
        : (
            fallback as unknown as (
              hostname: string,
              options: unknown,
              callback: LookupCallback,
            ) => void
          )(host, options, cb);
    }
    const opts =
      typeof options === "object" && options !== null
        ? (options as { all?: boolean; family?: number })
        : {};
    const requestedFamily = typeof options === "number" ? options : (opts.family ?? 0);
    const candidates =
      requestedFamily === 4 || requestedFamily === 6
        ? records.filter((entry) => entry.family === requestedFamily)
        : automaticRecords;
    const usable = candidates.length > 0 ? candidates : automaticRecords;
    if (opts.all) {
      cb(null, usable as LookupAddress[]);
      return;
    }
    const chosen = usable[index % usable.length];
    index += 1;
    cb(null, chosen.address, chosen.family);
  }) as typeof dnsLookupCb;
}
