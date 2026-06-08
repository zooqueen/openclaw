// Imessage API module exposes the plugin public contract.
import type {
  ChannelDoctorConfigMutation,
  ChannelDoctorLegacyConfigRule,
} from "openclaw/plugin-sdk/channel-contract";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";

// `channels.imessage.catchup` was retired: iMessage inbound recovery is now the
// always-on dedupe + stale-backlog age fence in the monitor, so the opt-in
// catchup replay subsystem and its config no longer exist. Detect the stale key
// so doctor reports it, and strip it in normalizeCompatibilityConfig so
// `openclaw doctor --fix` removes it from disk.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function imessageEntryHasCatchup(entry: unknown): boolean {
  if (!isRecord(entry)) {
    return false;
  }
  if (Object.hasOwn(entry, "catchup")) {
    return true;
  }
  const accounts = entry.accounts;
  if (!isRecord(accounts)) {
    return false;
  }
  return Object.values(accounts).some(
    (account) => isRecord(account) && Object.hasOwn(account, "catchup"),
  );
}

export const legacyConfigRules: ChannelDoctorLegacyConfigRule[] = [
  {
    path: ["channels", "imessage"],
    message:
      "channels.imessage.catchup is retired; iMessage now recovers via always-on inbound dedupe and a stale-backlog age fence. " +
      'Run "openclaw doctor --fix" to remove it.',
    match: (value) => imessageEntryHasCatchup(value),
  },
];

export function normalizeCompatibilityConfig({
  cfg,
}: {
  cfg: OpenClawConfig;
}): ChannelDoctorConfigMutation {
  const channels = cfg.channels as Record<string, unknown> | undefined;
  const imessage = channels?.imessage;
  if (!imessageEntryHasCatchup(imessage) || !isRecord(imessage)) {
    return { config: cfg, changes: [] };
  }
  const changes: string[] = [];
  const nextImessage: Record<string, unknown> = { ...imessage };
  if (Object.hasOwn(nextImessage, "catchup")) {
    delete nextImessage.catchup;
    changes.push("Removed retired channels.imessage.catchup.");
  }
  if (isRecord(nextImessage.accounts)) {
    let accountsChanged = false;
    const nextAccounts: Record<string, unknown> = { ...nextImessage.accounts };
    for (const [id, account] of Object.entries(nextImessage.accounts)) {
      if (isRecord(account) && Object.hasOwn(account, "catchup")) {
        const nextAccount = { ...account };
        delete nextAccount.catchup;
        nextAccounts[id] = nextAccount;
        accountsChanged = true;
        changes.push(`Removed retired channels.imessage.accounts.${id}.catchup.`);
      }
    }
    if (accountsChanged) {
      nextImessage.accounts = nextAccounts;
    }
  }
  return {
    config: {
      ...cfg,
      channels: { ...channels, imessage: nextImessage },
    } as OpenClawConfig,
    changes,
  };
}
