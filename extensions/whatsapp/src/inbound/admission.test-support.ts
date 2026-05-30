import type { WhatsAppInboundAdmission } from "./admission.js";
import type { WhatsAppSendResult } from "./send-result.js";
import type { WebInboundMessage } from "./types.js";

type AdmissionOverrides = {
  accountId?: string;
  chatType?: "direct" | "group";
  conversationId?: string;
  senderId?: string;
  dmSenderId?: string;
  requireMention?: boolean;
  groupAllowed?: boolean;
  groupAllowlistEnabled?: boolean;
  groupPolicy?: "open" | "allowlist" | "disabled";
  configuredAllowFrom?: string[];
  groupAllowFrom?: string[];
  isSelfChat?: boolean;
  account?: Partial<Omit<WhatsAppInboundAdmission["account"], "accountId">>;
  resolvedPolicy?: Partial<WhatsAppInboundAdmission["resolvedPolicy"]>;
  conversationGroupPolicy?: Partial<WhatsAppInboundAdmission["resolvedPolicy"]["groupAllowlist"]>;
  senderAccess?: Partial<WhatsAppInboundAdmission["senderAccess"]>;
};

export function createTestWhatsAppInboundAdmission(
  overrides: AdmissionOverrides = {},
): WhatsAppInboundAdmission {
  const accountId = overrides.accountId ?? "default";
  const chatType = overrides.chatType ?? "direct";
  const conversationId =
    overrides.conversationId ?? (chatType === "group" ? "1203630@g.us" : "+15550000002");
  const requireMention = overrides.requireMention ?? chatType === "group";
  const configuredAllowFrom = overrides.configuredAllowFrom ?? [];
  const groupAllowFrom = overrides.groupAllowFrom ?? configuredAllowFrom;
  const groupPolicy = overrides.groupPolicy ?? "open";
  const groupAllowlistEnabled = overrides.groupAllowlistEnabled ?? false;
  const groupAllowed = overrides.groupAllowed ?? true;
  const defaultSenderId = chatType === "direct" ? conversationId : "+15550000002";
  const senderId = overrides.senderId ?? defaultSenderId;
  const dmSenderId = overrides.dmSenderId ?? (chatType === "direct" ? senderId : conversationId);
  const groupAllowlist = {
    allowlistEnabled: groupAllowlistEnabled,
    allowed: groupAllowed,
    ...overrides.conversationGroupPolicy,
    ...overrides.resolvedPolicy?.groupAllowlist,
  };
  const contextVisibility = {
    groupPolicy,
    groupAllowFrom,
    requireMention,
    ...overrides.resolvedPolicy?.contextVisibility,
    groupAllowlist: {
      ...groupAllowlist,
      ...overrides.resolvedPolicy?.contextVisibility?.groupAllowlist,
    },
  };
  const commandAuthorization = {
    evaluated: true,
    authorized: true,
    reasonCode: "command_authorized" as const,
    ...overrides.resolvedPolicy?.commandAuthorization,
  };

  return {
    accountId,
    isSelfChat: overrides.isSelfChat ?? false,
    account: {
      accountId,
      authDir: "/tmp/auth",
      enabled: true,
      sendReadReceipts: true,
      ...overrides.account,
    },
    conversation: {
      kind: chatType,
      id: conversationId,
      groupSessionId: conversationId,
      requireMention,
    },
    sender: {
      id: senderId,
      dmSenderId,
      isSamePhone: false,
      isDmSenderSamePhone: false,
    },
    resolvedPolicy: {
      dmPolicy: "pairing",
      groupPolicy,
      configuredAllowFrom,
      dmAllowFrom: configuredAllowFrom,
      groupAllowFrom,
      providerMissingFallbackApplied: false,
      requireMention,
      ...overrides.resolvedPolicy,
      groupAllowlist,
      contextVisibility,
      commandAuthorization,
    },
    senderAccess: {
      allowed: true,
      decision: "allow",
      reasonCode: "dm_policy_allowlisted",
      effectiveAllowFrom: configuredAllowFrom,
      effectiveGroupAllowFrom: groupAllowFrom,
      providerMissingFallbackApplied: false,
      ...overrides.senderAccess,
    },
  };
}

type TestWebInboundPlatformOverrides = Partial<Omit<WebInboundMessage["platform"], "sender">> & {
  sender?: Partial<NonNullable<WebInboundMessage["platform"]["sender"]>>;
};

const defaultTestSendResult = (
  kind: WhatsAppSendResult["kind"],
  id: string,
): WhatsAppSendResult => ({
  kind,
  messageId: id,
  keys: [{ id }],
  providerAccepted: true,
});

export function createTestWebInboundMessage(
  params: {
    admissionOverrides?: AdmissionOverrides;
    event?: Partial<WebInboundMessage["event"]>;
    payload?: Partial<WebInboundMessage["payload"]>;
    quote?: WebInboundMessage["quote"] | null;
    group?: WebInboundMessage["group"] | null;
    platform?: TestWebInboundPlatformOverrides;
    wasMentioned?: boolean;
  } = {},
): WebInboundMessage {
  const admission = createTestWhatsAppInboundAdmission(params.admissionOverrides);
  const chatType = admission.conversation.kind;
  const conversationId = admission.conversation.id;
  const senderName = params.platform?.senderName ?? (chatType === "group" ? "Alice" : undefined);
  const quote = params.quote === null ? undefined : params.quote;
  const defaultGroup = chatType === "group" ? {} : undefined;
  const group = params.group === null ? undefined : (params.group ?? defaultGroup);
  const sender = {
    ...(senderName ? { name: senderName } : {}),
    ...params.platform?.sender,
  };

  return {
    admission,
    event: {
      id: "msg-1",
      timestamp: 1_700_000_000,
      ...params.event,
    },
    payload: {
      body: "hello",
      ...params.payload,
    },
    platform: {
      chatJid: params.platform?.chatJid ?? conversationId,
      recipientJid: params.platform?.recipientJid ?? "+15550000001",
      sender,
      senderJid: params.platform?.senderJid,
      senderName: params.platform?.senderName ?? senderName,
      pushName: params.platform?.pushName ?? senderName,
      self: params.platform?.self,
      selfJid: params.platform?.selfJid ?? undefined,
      selfLid: params.platform?.selfLid ?? undefined,
      selfE164: params.platform?.selfE164 ?? undefined,
      fromMe: params.platform?.fromMe,
      sendComposing: params.platform?.sendComposing ?? (async () => undefined),
      reply: params.platform?.reply ?? (async () => defaultTestSendResult("text", "reply-1")),
      sendMedia:
        params.platform?.sendMedia ?? (async () => defaultTestSendResult("media", "media-1")),
    },
    from: conversationId,
    conversationId,
    accountId: admission.accountId,
    accessControlPassed: true,
    chatType,
    ...(quote ? { quote } : {}),
    ...(group ? { group } : {}),
    ...(params.wasMentioned !== undefined ? { wasMentioned: params.wasMentioned } : {}),
  };
}
