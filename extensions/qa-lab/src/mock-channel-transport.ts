// Qa Lab plugin module implements mock upstream channel transports.
import type { QaBusState } from "./bus-state.js";
import type { QaMockChannelDriver, QaMockChannelId } from "./channel-capability-matrix.js";
import { getQaMockChannelDriver } from "./channel-capability-matrix.js";
import { getQaProvider } from "./providers/index.js";
import {
  createQaChannelGatewayConfig,
  handleQaChannelAction,
  QA_CHANNEL_ID,
  waitForQaChannelReady,
} from "./qa-channel-transport.js";
import { QaStateBackedTransportAdapter } from "./qa-transport.js";
import type {
  QaTransportActionName,
  QaTransportGatewayConfig,
  QaTransportGatewayClient,
  QaTransportReportParams,
} from "./qa-transport.js";

const QA_MOCK_CHANNEL_ACCOUNT_ID = "mock";

function createMockChannelReportNotes(
  driver: QaMockChannelDriver,
  params: QaTransportReportParams,
) {
  const provider = getQaProvider(params.providerMode);
  const providerText =
    provider.kind === "mock"
      ? `${params.providerMode} provider fixture`
      : `live frontier models (${params.primaryModel}, ${params.alternateModel})`;
  return [
    `Runs ${driver.label} through mock upstream driver ${driver.mockDriverId} backed by the qa-lab normalized bus.`,
    `Gateway transport execution uses the qa-channel shim while summary metadata records channel=${driver.channelId} and channel_live=false.`,
    `Model responses use ${providerText}${params.fastMode ? " with fast mode enabled" : ""}.`,
  ];
}

class QaMockChannelTransport extends QaStateBackedTransportAdapter {
  constructor(
    state: QaBusState,
    private readonly driver: QaMockChannelDriver,
  ) {
    super({
      id: driver.channelId,
      channelId: driver.channelId,
      channelLive: false,
      mockUpstreamDriverId: driver.mockDriverId,
      label: `${driver.label} mock upstream + qa-lab bus`,
      accountId: QA_MOCK_CHANNEL_ACCOUNT_ID,
      requiredPluginIds: driver.runtimePluginIds,
      state,
    });
  }

  createGatewayConfig = (params: { baseUrl: string }): QaTransportGatewayConfig =>
    createQaChannelGatewayConfig(params);

  waitReady = (params: {
    gateway: QaTransportGatewayClient;
    timeoutMs?: number;
    pollIntervalMs?: number;
  }) => waitForQaChannelReady(params);

  buildAgentDelivery = ({ target }: { target: string }) => ({
    channel: QA_CHANNEL_ID,
    replyChannel: QA_CHANNEL_ID,
    replyTo: target,
  });

  handleAction = (params: {
    action: QaTransportActionName;
    args: Record<string, unknown>;
    cfg: Parameters<typeof handleQaChannelAction>[0]["cfg"];
    accountId?: string | null;
  }) => handleQaChannelAction(params);

  createReportNotes = (params: QaTransportReportParams) =>
    createMockChannelReportNotes(this.driver, params);
}

export function createQaMockChannelTransport(params: {
  channelId: QaMockChannelId;
  state: QaBusState;
}) {
  const driver = getQaMockChannelDriver(params.channelId);
  if (!driver) {
    throw new Error(`unsupported QA mock channel: ${params.channelId}`);
  }
  return new QaMockChannelTransport(params.state, driver);
}
