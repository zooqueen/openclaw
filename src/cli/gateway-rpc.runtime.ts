import { callGateway } from "../gateway/call.js";
import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "../gateway/protocol/client-info.js";
import type { GatewayRpcOpts } from "./gateway-rpc.types.js";
import { parsePositiveIntOrUndefined } from "./program/helpers.js";
import { withProgress } from "./progress.js";

type CallGatewayFromCliRuntimeExtra = {
  clientName?: Parameters<typeof callGateway>[0]["clientName"];
  mode?: Parameters<typeof callGateway>[0]["mode"];
  deviceIdentity?: Parameters<typeof callGateway>[0]["deviceIdentity"];
  expectFinal?: boolean;
  progress?: boolean;
  scopes?: Parameters<typeof callGateway>[0]["scopes"];
};

function resolveGatewayTimeoutMs(value: GatewayRpcOpts["timeout"]): number {
  const parsed = parsePositiveIntOrUndefined(value);
  if (value !== undefined && parsed === undefined) {
    throw new Error("--timeout must be a positive integer (milliseconds)");
  }
  return parsed ?? 10_000;
}

export async function callGatewayFromCliRuntime(
  method: string,
  opts: GatewayRpcOpts,
  params?: unknown,
  extra?: CallGatewayFromCliRuntimeExtra,
) {
  const showProgress = extra?.progress ?? opts.json !== true;
  return await withProgress(
    {
      label: `Gateway ${method}`,
      indeterminate: true,
      enabled: showProgress,
    },
    async () =>
      await callGateway({
        url: opts.url,
        token: opts.token,
        method,
        params,
        deviceIdentity: extra?.deviceIdentity,
        expectFinal: extra?.expectFinal ?? Boolean(opts.expectFinal),
        scopes: extra?.scopes,
        timeoutMs: resolveGatewayTimeoutMs(opts.timeout),
        clientName: extra?.clientName ?? GATEWAY_CLIENT_NAMES.CLI,
        mode: extra?.mode ?? GATEWAY_CLIENT_MODES.CLI,
      }),
  );
}
