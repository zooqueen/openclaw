import { describe, expect, it } from "vitest";
import {
  NetworkTargetBlockedError,
  isPrivateIpAddress,
  resolvePinnedHostnameWithPolicy,
  type LookupFn,
} from "./ssrf.js";

function createLookupFn(address: string): LookupFn {
  return (async () => [{ address, family: address.includes(":") ? 6 : 4 }]) as unknown as LookupFn;
}

async function readPinnedLookupAddress(
  lookup: Awaited<ReturnType<typeof resolvePinnedHostnameWithPolicy>>["lookup"],
  hostname: string,
): Promise<string> {
  return await new Promise((resolve, reject) => {
    lookup(hostname, (err, address) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(Array.isArray(address) ? (address[0]?.address ?? "") : address);
    });
  });
}

describe("browser network target policy helper", () => {
  it("blocks metadata and link-local DNS answers for trusted hostnames", async () => {
    await expect(
      resolvePinnedHostnameWithPolicy("trusted.example", {
        lookupFn: createLookupFn("169.254.169.254"),
        policy: { allowedHostnames: ["trusted.example"] },
      }),
    ).rejects.toBeInstanceOf(NetworkTargetBlockedError);

    await expect(
      resolvePinnedHostnameWithPolicy("trusted.example", {
        lookupFn: createLookupFn("fd00:ec2::254"),
        policy: { allowedHostnames: ["trusted.example"] },
      }),
    ).rejects.toBeInstanceOf(NetworkTargetBlockedError);
  });

  it.each(["100::", "2001:20::", "fec0::1", "64:ff9b::169.254.169.254", "2002:6464:64c8::"])(
    "blocks special-use IPv6 target %s",
    (address) => {
      expect(isPrivateIpAddress(address)).toBe(true);
    },
  );

  it("prefers IPv4 answers for automatic pinned lookups", async () => {
    const pinned = await resolvePinnedHostnameWithPolicy("example.invalid", {
      lookupFn: (async () => [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
      ]) as unknown as LookupFn,
    });

    expect(pinned.addresses).toEqual(["93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946"]);
    await expect(readPinnedLookupAddress(pinned.lookup, "example.invalid")).resolves.toBe(
      "93.184.216.34",
    );
  });
});
