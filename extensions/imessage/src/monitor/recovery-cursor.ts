// Per-account high-water of the last dispatched chat.db rowid. On startup it is
// passed to imsg `watch.subscribe` as `since_rowid` so imsg replays the rows
// that landed while the gateway was down (downtime recovery), then tails live.
// The GUID dedupe makes this safe — anything already handled is dropped — so
// this needs none of the cursor/retry bookkeeping the old catchup subsystem
// carried. Single number per account.
import { getIMessageRuntime } from "../runtime.js";

export const IMESSAGE_RECOVERY_CURSOR_NAMESPACE = "imessage.recovery-cursor";
export const IMESSAGE_RECOVERY_CURSOR_MAX_ENTRIES = 64;

type RecoveryCursor = { lastRowid: number };

function openRecoveryCursorStore() {
  return getIMessageRuntime().state.openSyncKeyedStore<RecoveryCursor>({
    namespace: IMESSAGE_RECOVERY_CURSOR_NAMESPACE,
    maxEntries: IMESSAGE_RECOVERY_CURSOR_MAX_ENTRIES,
  });
}

/** Last dispatched rowid for this account, or null when none is recorded yet. */
export function loadIMessageRecoveryCursor(accountId: string): number | null {
  try {
    const value = openRecoveryCursorStore().lookup(accountId);
    return typeof value?.lastRowid === "number" && Number.isFinite(value.lastRowid)
      ? value.lastRowid
      : null;
  } catch {
    return null;
  }
}

/** Advance the cursor forward to `rowid` (monotonic; never rewinds). */
export function advanceIMessageRecoveryCursor(accountId: string, rowid: number): void {
  if (!Number.isFinite(rowid)) {
    return;
  }
  try {
    const store = openRecoveryCursorStore();
    const current = store.lookup(accountId);
    if (current && current.lastRowid >= rowid) {
      return;
    }
    store.register(accountId, { lastRowid: rowid });
  } catch {
    // Best effort: a failed cursor write just means we replay a little more
    // next startup, which the dedupe absorbs.
  }
}
