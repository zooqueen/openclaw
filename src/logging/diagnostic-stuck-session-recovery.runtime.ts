import { resolveEmbeddedSessionLane } from "../agents/pi-embedded-runner/lanes.js";
import {
  abortAndDrainEmbeddedPiRun,
  isEmbeddedPiRunActive,
  isEmbeddedPiRunHandleActive,
  resolveActiveEmbeddedRunSessionId,
  resolveActiveEmbeddedRunHandleSessionId,
} from "../agents/pi-embedded-runner/runs.js";
import { getCommandLaneSnapshot, resetCommandLane } from "../process/command-queue.js";
import { diagnosticLogger as diag } from "./diagnostic-runtime.js";

const STUCK_SESSION_ABORT_SETTLE_MS = 15_000;
const recoveriesInFlight = new Set<string>();

export type StuckSessionRecoveryParams = {
  sessionId?: string;
  sessionKey?: string;
  ageMs: number;
  queueDepth?: number;
  allowActiveAbort?: boolean;
};

export type StuckSessionRecoveryResult = {
  status: "recovered" | "deferred" | "failed";
  action:
    | "aborted_run"
    | "active_work_kept"
    | "cleared_stale_state"
    | "missing_session_ref"
    | "recovery_in_flight"
    | "released_lane"
    | "released_unregistered_lane";
  aborted?: boolean;
  drained?: boolean;
  forceCleared?: boolean;
  released?: number;
};

function recoveryResult(
  status: StuckSessionRecoveryResult["status"],
  action: StuckSessionRecoveryResult["action"],
  extra?: Omit<StuckSessionRecoveryResult, "status" | "action">,
): StuckSessionRecoveryResult {
  return { status, action, ...extra };
}

function recoveryKey(params: StuckSessionRecoveryParams): string | undefined {
  return params.sessionKey?.trim() || params.sessionId?.trim() || undefined;
}

function formatRecoveryContext(
  params: StuckSessionRecoveryParams,
  extra?: { activeSessionId?: string; lane?: string; activeCount?: number; queuedCount?: number },
): string {
  const fields = [
    `sessionId=${params.sessionId ?? extra?.activeSessionId ?? "unknown"}`,
    `sessionKey=${params.sessionKey ?? "unknown"}`,
    `age=${Math.round(params.ageMs / 1000)}s`,
    `queueDepth=${params.queueDepth ?? 0}`,
  ];
  if (extra?.activeSessionId) {
    fields.push(`activeSessionId=${extra.activeSessionId}`);
  }
  if (extra?.lane) {
    fields.push(`lane=${extra.lane}`);
  }
  if (extra?.activeCount !== undefined) {
    fields.push(`laneActive=${extra.activeCount}`);
  }
  if (extra?.queuedCount !== undefined) {
    fields.push(`laneQueued=${extra.queuedCount}`);
  }
  return fields.join(" ");
}

export async function recoverStuckDiagnosticSession(
  params: StuckSessionRecoveryParams,
): Promise<StuckSessionRecoveryResult> {
  const key = recoveryKey(params);
  if (!key || recoveriesInFlight.has(key)) {
    return recoveryResult("deferred", key ? "recovery_in_flight" : "missing_session_ref");
  }

  recoveriesInFlight.add(key);
  try {
    const fallbackActiveSessionId =
      params.sessionId && isEmbeddedPiRunHandleActive(params.sessionId)
        ? params.sessionId
        : undefined;
    const activeSessionId = params.sessionKey
      ? (resolveActiveEmbeddedRunHandleSessionId(params.sessionKey) ?? fallbackActiveSessionId)
      : fallbackActiveSessionId;
    const activeWorkSessionId = params.sessionKey
      ? (resolveActiveEmbeddedRunSessionId(params.sessionKey) ?? params.sessionId)
      : params.sessionId;
    const laneKey = params.sessionKey?.trim() || params.sessionId?.trim();
    const sessionLane = laneKey ? resolveEmbeddedSessionLane(laneKey) : null;
    let aborted = false;
    let drained = true;
    let forceCleared = false;

    if (activeSessionId) {
      if (params.allowActiveAbort !== true) {
        diag.warn(
          `stuck session recovery skipped: reason=active_embedded_run action=observe_only ${formatRecoveryContext(
            params,
            { activeSessionId },
          )}`,
        );
        return recoveryResult("deferred", "active_work_kept");
      }
      const result = await abortAndDrainEmbeddedPiRun({
        sessionId: activeSessionId,
        sessionKey: params.sessionKey,
        settleMs: STUCK_SESSION_ABORT_SETTLE_MS,
        forceClear: true,
        reason: "stuck_recovery",
      });
      aborted = result.aborted;
      drained = result.drained;
      forceCleared = result.forceCleared;
      if (result.aborted && result.drained) {
        return recoveryResult("recovered", "aborted_run", {
          aborted: result.aborted,
          drained: result.drained,
          forceCleared: result.forceCleared,
        });
      }
    }

    if (!activeSessionId && activeWorkSessionId && isEmbeddedPiRunActive(activeWorkSessionId)) {
      if (params.allowActiveAbort === true) {
        const result = await abortAndDrainEmbeddedPiRun({
          sessionId: activeWorkSessionId,
          sessionKey: params.sessionKey,
          settleMs: STUCK_SESSION_ABORT_SETTLE_MS,
          forceClear: true,
          reason: "stuck_recovery",
        });
        aborted = result.aborted;
        drained = result.drained;
        forceCleared = result.forceCleared;
        if (result.aborted && result.drained) {
          return recoveryResult("recovered", "aborted_run", {
            aborted: result.aborted,
            drained: result.drained,
            forceCleared: result.forceCleared,
          });
        }
      } else {
        diag.warn(
          `stuck session recovery skipped: reason=active_reply_work action=keep_lane ${formatRecoveryContext(
            params,
            { activeSessionId: activeWorkSessionId },
          )}`,
        );
        return recoveryResult("deferred", "active_work_kept");
      }
    }

    if (!activeSessionId && sessionLane) {
      const laneSnapshot = getCommandLaneSnapshot(sessionLane);
      if (laneSnapshot.activeCount > 0) {
        if (params.allowActiveAbort === true) {
          const released = resetCommandLane(sessionLane);
          diag.warn(
            `stuck session recovery: reason=active_lane_task action=release_lane ${formatRecoveryContext(
              params,
              {
                lane: sessionLane,
                activeCount: laneSnapshot.activeCount,
                queuedCount: laneSnapshot.queuedCount,
              },
            )} released=${released}`,
          );
          return recoveryResult(
            released > 0 ? "recovered" : "deferred",
            "released_unregistered_lane",
            {
              released,
            },
          );
        }
        diag.warn(
          `stuck session recovery skipped: reason=active_lane_task action=keep_lane ${formatRecoveryContext(
            params,
            {
              lane: sessionLane,
              activeCount: laneSnapshot.activeCount,
              queuedCount: laneSnapshot.queuedCount,
            },
          )}`,
        );
        return recoveryResult("deferred", "active_work_kept");
      }
    }

    const released =
      sessionLane && (!activeSessionId || !aborted || !drained) ? resetCommandLane(sessionLane) : 0;

    if (aborted || released > 0) {
      diag.warn(
        `stuck session recovery: sessionId=${params.sessionId ?? activeSessionId ?? "unknown"} sessionKey=${
          params.sessionKey ?? "unknown"
        } age=${Math.round(params.ageMs / 1000)}s aborted=${aborted} drained=${drained} released=${released}`,
      );
      return recoveryResult("recovered", aborted ? "aborted_run" : "released_lane", {
        aborted,
        drained,
        forceCleared,
        released,
      });
    }
    diag.warn(
      `stuck session recovery no-op: reason=no_active_work action=none ${formatRecoveryContext(
        params,
        {
          lane: sessionLane ?? undefined,
        },
      )}`,
    );
    return recoveryResult("recovered", "cleared_stale_state", { released: 0 });
  } catch (err) {
    diag.warn(
      `stuck session recovery failed: sessionId=${params.sessionId ?? "unknown"} sessionKey=${
        params.sessionKey ?? "unknown"
      } err=${String(err)}`,
    );
    return recoveryResult("failed", "active_work_kept");
  } finally {
    recoveriesInFlight.delete(key);
  }
}

export const __testing = {
  resetRecoveriesInFlight(): void {
    recoveriesInFlight.clear();
  },
};
