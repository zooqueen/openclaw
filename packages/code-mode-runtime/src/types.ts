export type CodeModeBridgeMethod = "search" | "describe" | "call" | "yield";

export type CodeModeRuntimeConfig = {
  timeoutMs: number;
  memoryLimitBytes: number;
  maxPendingToolCalls: number;
  maxSnapshotBytes: number;
};

export type CodeModePendingBridgeRequest = {
  id: string;
  method: CodeModeBridgeMethod;
  args: unknown[];
};

export type CodeModeSettledBridgeRequest = {
  id: string;
  ok: boolean;
  value?: unknown;
  error?: string;
};

export type CodeModeWorkerInput =
  | {
      kind: "exec";
      source: string;
      config: CodeModeRuntimeConfig;
      catalog: unknown[];
    }
  | {
      kind: "resume";
      snapshotBytes: Uint8Array;
      config: CodeModeRuntimeConfig;
      settledRequests: CodeModeSettledBridgeRequest[];
    };

export type CodeModeFailureCode =
  | "invalid_input"
  | "runtime_unavailable"
  | "timeout"
  | "output_limit_exceeded"
  | "snapshot_limit_exceeded"
  | "internal_error";

export type CodeModeWorkerResult =
  | {
      status: "completed";
      value: unknown;
      output: unknown[];
    }
  | {
      status: "waiting";
      snapshotBytes: Uint8Array;
      pendingRequests: CodeModePendingBridgeRequest[];
      output: unknown[];
    }
  | {
      status: "failed";
      error: string;
      code: CodeModeFailureCode;
      output: unknown[];
    };
