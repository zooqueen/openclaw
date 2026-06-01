import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import {
  resolveRealtimeVoiceFastContextConsult,
  type RealtimeVoiceFastContextConsultResult,
  type RealtimeVoiceFastContextConfig,
} from "openclaw/plugin-sdk/realtime-voice";

type Logger = {
  debug?: (message: string) => void;
};

export async function resolveRealtimeFastContextConsult(params: {
  cfg: OpenClawConfig;
  agentId: string;
  sessionKey: string;
  config: RealtimeVoiceFastContextConfig;
  args: unknown;
  logger: Logger;
}): Promise<RealtimeVoiceFastContextConsultResult> {
  // Voice-call consults share the SDK resolver, but label the audience as a
  // caller so fallback prompts and logs stay telephony-specific.
  return await resolveRealtimeVoiceFastContextConsult({
    ...params,
    labels: {
      audienceLabel: "caller",
      contextName: "OpenClaw memory or session context",
    },
  });
}
