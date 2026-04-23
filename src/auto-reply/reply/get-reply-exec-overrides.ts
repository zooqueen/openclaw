import type { ExecToolDefaults } from "../../agents/bash-tools.js";
import type { SessionEntry } from "../../config/sessions.js";
import {
  resolveExecPolicyForMode,
  type ExecAsk,
  type ExecMode,
  type ExecSecurity,
} from "../../infra/exec-approvals.js";
import type { InlineDirectives } from "./directive-handling.parse.js";

export type ReplyExecOverrides = Pick<
  ExecToolDefaults,
  "host" | "mode" | "security" | "ask" | "node"
>;

export function resolveReplyExecOverrides(params: {
  directives: InlineDirectives;
  sessionEntry?: SessionEntry;
  agentExecDefaults?: ReplyExecOverrides;
}): ReplyExecOverrides | undefined {
  const host =
    params.directives.execHost ??
    (params.sessionEntry?.execHost as ReplyExecOverrides["host"]) ??
    params.agentExecDefaults?.host;
  const basePolicy = materializeExecPolicy(params.agentExecDefaults);
  const sessionPolicy = applyExecPolicyLayer(basePolicy, {
    mode: params.sessionEntry?.execMode as ExecMode | undefined,
    security: params.sessionEntry?.execSecurity as ExecSecurity | undefined,
    ask: params.sessionEntry?.execAsk as ExecAsk | undefined,
  });
  const policy = applyExecPolicyLayer(sessionPolicy, {
    mode: params.directives.execMode,
    security: params.directives.execSecurity,
    ask: params.directives.execAsk,
  });
  const node =
    params.directives.execNode ?? params.sessionEntry?.execNode ?? params.agentExecDefaults?.node;
  const mode = policy.mode;
  const security = mode ? undefined : policy.security;
  const ask = mode ? undefined : policy.ask;
  if (!host && !mode && !security && !ask && !node) {
    return undefined;
  }
  return { host, mode, security, ask, node };
}

function materializeExecPolicy(exec?: ReplyExecOverrides): {
  mode?: ExecMode;
  security?: ExecSecurity;
  ask?: ExecAsk;
} {
  if (exec?.mode) {
    const modePolicy = resolveExecPolicyForMode(exec.mode);
    return {
      mode: exec.mode,
      security: exec.security ?? modePolicy.security,
      ask: exec.ask ?? modePolicy.ask,
    };
  }
  return {
    security: exec?.security,
    ask: exec?.ask,
  };
}

function applyExecPolicyLayer(
  base: { mode?: ExecMode; security?: ExecSecurity; ask?: ExecAsk },
  layer: { mode?: ExecMode; security?: ExecSecurity; ask?: ExecAsk },
): { mode?: ExecMode; security?: ExecSecurity; ask?: ExecAsk } {
  if (layer.mode) {
    const policy = resolveExecPolicyForMode(layer.mode);
    return {
      mode: layer.mode,
      security: policy.security,
      ask: policy.ask,
    };
  }
  if (layer.security !== undefined || layer.ask !== undefined) {
    return {
      security: layer.security ?? base.security,
      ask: layer.ask ?? base.ask,
    };
  }
  return base;
}
