import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { getReplyContext, getSenderIdentity } from "../../identity.js";
import type { WebInboundMessage } from "../../inbound/types.js";
import {
  formatInboundEnvelope,
  resolveMessagePrefix,
  type EnvelopeFormatOptions,
} from "./message-line.runtime.js";

export function formatReplyContext(msg: WebInboundMessage) {
  const replyTo = getReplyContext(msg, msg.admission.account.authDir);
  if (!replyTo?.body) {
    return null;
  }
  const sender = replyTo.sender?.label ?? replyTo.sender?.e164 ?? "unknown sender";
  const idPart = replyTo.id ? ` id:${replyTo.id}` : "";
  return `[Replying to ${sender}${idPart}]\n${replyTo.body}\n[/Replying]`;
}

export function buildInboundLine(params: {
  cfg: OpenClawConfig;
  msg: WebInboundMessage;
  agentId: string;
  previousTimestamp?: number;
  envelope?: EnvelopeFormatOptions;
}) {
  const { cfg, msg, agentId, previousTimestamp, envelope } = params;
  // WhatsApp inbound prefix: channels.whatsapp.messagePrefix > legacy messages.messagePrefix > identity/defaults
  const messagePrefix = resolveMessagePrefix(cfg, agentId, {
    configured: cfg.channels?.whatsapp?.messagePrefix,
    hasAllowFrom: msg.admission.resolvedPolicy.configuredAllowFrom.length > 0,
  });
  const prefixStr = messagePrefix ? `${messagePrefix} ` : "";
  const replyContext = formatReplyContext(msg);
  const baseLine = `${prefixStr}${msg.payload.body}${replyContext ? `\n\n${replyContext}` : ""}`;
  const sender = getSenderIdentity(msg, msg.admission.account.authDir);
  const admittedSenderId = msg.admission.sender.id || undefined;
  const chatType = msg.admission.conversation.kind;
  const conversationId = msg.admission.conversation.id;

  // Wrap with standardized envelope for the agent.
  return formatInboundEnvelope({
    channel: "WhatsApp",
    from: chatType === "group" ? conversationId : conversationId.replace(/^whatsapp:/, ""),
    timestamp: msg.event.timestamp,
    body: baseLine,
    chatType,
    sender: {
      name: sender.name ?? undefined,
      e164: sender.e164 ?? undefined,
      id: admittedSenderId,
    },
    previousTimestamp,
    envelope,
    fromMe: msg.platform.fromMe,
  });
}
