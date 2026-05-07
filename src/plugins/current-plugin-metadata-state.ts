let currentPluginMetadataSnapshot: unknown;
let currentPluginMetadataSnapshotConfigFingerprint: string | undefined;
let currentPluginMetadataSnapshotCompatiblePolicyHashes: readonly string[] | undefined;
let currentPluginMetadataSnapshotCompatibleConfigFingerprints: readonly string[] | undefined;
let currentPluginMetadataSnapshotInventoryFingerprint: string | undefined;

export function setCurrentPluginMetadataSnapshotState(
  snapshot: unknown,
  configFingerprint: string | undefined,
  compatiblePolicyHashes?: readonly string[],
  compatibleConfigFingerprints?: readonly string[],
  inventoryFingerprint?: string,
): void {
  currentPluginMetadataSnapshot = snapshot;
  currentPluginMetadataSnapshotConfigFingerprint = snapshot ? configFingerprint : undefined;
  currentPluginMetadataSnapshotCompatiblePolicyHashes = snapshot
    ? compatiblePolicyHashes
    : undefined;
  currentPluginMetadataSnapshotCompatibleConfigFingerprints = snapshot
    ? compatibleConfigFingerprints
    : undefined;
  currentPluginMetadataSnapshotInventoryFingerprint = snapshot ? inventoryFingerprint : undefined;
}

export function clearCurrentPluginMetadataSnapshotState(): void {
  currentPluginMetadataSnapshot = undefined;
  currentPluginMetadataSnapshotConfigFingerprint = undefined;
  currentPluginMetadataSnapshotCompatiblePolicyHashes = undefined;
  currentPluginMetadataSnapshotCompatibleConfigFingerprints = undefined;
  currentPluginMetadataSnapshotInventoryFingerprint = undefined;
}

export function getCurrentPluginMetadataSnapshotState(): {
  snapshot: unknown;
  configFingerprint: string | undefined;
  compatiblePolicyHashes: readonly string[] | undefined;
  compatibleConfigFingerprints: readonly string[] | undefined;
  inventoryFingerprint: string | undefined;
} {
  return {
    snapshot: currentPluginMetadataSnapshot,
    configFingerprint: currentPluginMetadataSnapshotConfigFingerprint,
    compatiblePolicyHashes: currentPluginMetadataSnapshotCompatiblePolicyHashes,
    compatibleConfigFingerprints: currentPluginMetadataSnapshotCompatibleConfigFingerprints,
    inventoryFingerprint: currentPluginMetadataSnapshotInventoryFingerprint,
  };
}
