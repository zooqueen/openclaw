import { syncEffect } from "../../effect-runtime/index.js";
import {
  getDiagnosticStabilitySnapshot,
  normalizeDiagnosticStabilityQuery,
} from "../../logging/diagnostic-stability.js";
import { invalidGatewayMethodRequest, respondWithGatewayEffect } from "./effect.js";
import type { GatewayRequestHandlers } from "./types.js";

export const diagnosticsHandlers: GatewayRequestHandlers = {
  "diagnostics.stability": async ({ params, respond }) => {
    await respondWithGatewayEffect({
      respond,
      effect: syncEffect({
        try: () => getDiagnosticStabilitySnapshot(normalizeDiagnosticStabilityQuery(params)),
        catch: (err) =>
          invalidGatewayMethodRequest(
            err instanceof Error ? err.message : "invalid diagnostics.stability params",
          ),
      }),
    });
  },
};
