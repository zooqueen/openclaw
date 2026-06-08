// Qa Lab plugin module defines mock channel coverage for scorecard ingestion.

export type QaMockChannelId = "telegram";

export type QaChannelId = QaMockChannelId | "discord" | "slack" | "whatsapp";

export type QaChannelCapabilityId =
  | "dm"
  | "group-mention"
  | "thread"
  | "media-metadata"
  | "native-approval"
  | "reconnect"
  | "outbound-transcript";

export type QaChannelCapabilityStatus = "covered" | "planned";

export type QaChannelCapabilityMatrixEntry = {
  channelId: QaChannelId;
  label: string;
  mockDriverId: string | null;
  channelLive: false;
  runtimePluginIds: readonly string[];
  coverageIds: readonly string[];
  capabilities: Readonly<
    Record<
      QaChannelCapabilityId,
      {
        status: QaChannelCapabilityStatus;
        coverageId: string;
      }
    >
  >;
};

export type QaChannelCapabilityMatrix = {
  version: 1;
  channels: readonly QaChannelCapabilityMatrixEntry[];
};

export type QaMockChannelDriver = QaChannelCapabilityMatrixEntry & {
  channelId: QaMockChannelId;
  mockDriverId: string;
};

export const QA_CHANNEL_CAPABILITY_MATRIX_PATH = "channel-capability-matrix.json";

const qaChannelCapabilityIds = [
  "dm",
  "group-mention",
  "thread",
  "media-metadata",
  "native-approval",
  "reconnect",
  "outbound-transcript",
] as const satisfies readonly QaChannelCapabilityId[];

function buildCapabilitySet(
  channelId: QaChannelId,
  coveredCapabilityIds: readonly QaChannelCapabilityId[] = [],
) {
  const covered = new Set<QaChannelCapabilityId>(coveredCapabilityIds);
  return Object.fromEntries(
    qaChannelCapabilityIds.map((capabilityId) => [
      capabilityId,
      {
        status: covered.has(capabilityId) ? "covered" : "planned",
        coverageId: `channels.${channelId}.${capabilityId}`,
      },
    ]),
  ) as QaChannelCapabilityMatrixEntry["capabilities"];
}

const channelCapabilityMatrix: QaChannelCapabilityMatrix = {
  version: 1,
  channels: [
    {
      channelId: "telegram",
      label: "Telegram",
      mockDriverId: "telegram-normalized-bus-v1",
      channelLive: false,
      runtimePluginIds: ["qa-channel"],
      coverageIds: [
        "channels.telegram.mock-upstream",
        "channels.telegram.dm",
        "channels.telegram.group-mention",
        "channels.telegram.outbound-transcript",
      ],
      capabilities: buildCapabilitySet("telegram", ["dm", "group-mention", "outbound-transcript"]),
    },
    {
      channelId: "discord",
      label: "Discord",
      mockDriverId: null,
      channelLive: false,
      runtimePluginIds: [],
      coverageIds: ["channels.discord.mock-upstream"],
      capabilities: buildCapabilitySet("discord"),
    },
    {
      channelId: "slack",
      label: "Slack",
      mockDriverId: null,
      channelLive: false,
      runtimePluginIds: [],
      coverageIds: ["channels.slack.mock-upstream"],
      capabilities: buildCapabilitySet("slack"),
    },
    {
      channelId: "whatsapp",
      label: "WhatsApp",
      mockDriverId: null,
      channelLive: false,
      runtimePluginIds: [],
      coverageIds: ["channels.whatsapp.mock-upstream"],
      capabilities: buildCapabilitySet("whatsapp"),
    },
  ],
};

export function buildQaChannelCapabilityMatrix(): QaChannelCapabilityMatrix {
  return channelCapabilityMatrix;
}

export function listQaMockChannelIds(): readonly QaMockChannelId[] {
  return channelCapabilityMatrix.channels
    .filter((entry): entry is QaMockChannelDriver => entry.mockDriverId !== null)
    .map((entry) => entry.channelId);
}

export function getQaMockChannelDriver(channelId: string): QaMockChannelDriver | undefined {
  return channelCapabilityMatrix.channels.find(
    (entry): entry is QaMockChannelDriver =>
      entry.channelId === channelId && entry.mockDriverId !== null,
  );
}
