import {
  abortEmbeddedAgentRun,
  resolveActiveEmbeddedAgentRunSessionIdByRunId,
} from "../../agents/pi-embedded.js";

export { runEmbeddedAgent, runEmbeddedPiAgent } from "../../agents/pi-embedded.js";

export async function abort(params: { runId: string }): Promise<boolean> {
  const sessionId = resolveActiveEmbeddedAgentRunSessionIdByRunId(params.runId);
  return sessionId ? abortEmbeddedAgentRun(sessionId) : false;
}
