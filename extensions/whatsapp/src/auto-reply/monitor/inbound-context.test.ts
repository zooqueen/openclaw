import { describe, expect, it } from "vitest";
import { createTestWebInboundMessage } from "../../inbound/admission.test-support.js";
import type { WhatsAppSendResult } from "../../inbound/send-result.js";
import {
  resolveVisibleWhatsAppGroupHistory,
  resolveVisibleWhatsAppReplyContext,
} from "./inbound-context.js";

type ReplyContextParams = Parameters<typeof resolveVisibleWhatsAppReplyContext>[0];

function acceptedSendResult(kind: "media" | "text", id: string): WhatsAppSendResult {
  return {
    kind,
    messageId: id,
    keys: [{ id }],
    providerAccepted: true,
  };
}

const makeBlockedQuotedReplyMessage = (id: string): ReplyContextParams["msg"] =>
  createTestWebInboundMessage({
    admissionOverrides: {
      chatType: "group",
      conversationId: "123@g.us",
    },
    event: {
      id,
    },
    payload: {
      body: "Current message",
    },
    platform: {
      recipientJid: "+2000",
      senderName: "Alice",
      senderJid: "111@s.whatsapp.net",
      selfE164: "+999",
      sendComposing: async () => {},
      reply: async () => acceptedSendResult("text", "r1"),
      sendMedia: async () => acceptedSendResult("media", "m1"),
    },
    quote: {
      id: "blocked-reply",
      body: "Blocked quoted text",
      sender: {
        displayName: "Mallory (+999)",
        jid: "999@s.whatsapp.net",
      },
    },
  });

describe("whatsapp inbound context visibility", () => {
  it("filters non-allowlisted group history from supplemental context", () => {
    const history = resolveVisibleWhatsAppGroupHistory({
      history: [
        {
          sender: "Alice (+111)",
          body: "Allowed context",
          senderJid: "111@s.whatsapp.net",
        },
        {
          sender: "Mallory (+999)",
          body: "Blocked context",
          senderJid: "999@s.whatsapp.net",
        },
      ],
      mode: "allowlist",
      groupPolicy: "allowlist",
      groupAllowFrom: ["+111"],
    });

    expect(history).toEqual([
      {
        sender: "Alice (+111)",
        body: "Allowed context",
        senderJid: "111@s.whatsapp.net",
      },
    ]);
  });

  it("redacts blocked quoted replies in allowlist mode", () => {
    const reply = resolveVisibleWhatsAppReplyContext({
      msg: makeBlockedQuotedReplyMessage("msg-reply-1"),
      mode: "allowlist",
      groupPolicy: "allowlist",
      groupAllowFrom: ["+111"],
    });

    expect(reply).toBeNull();
  });

  it("keeps blocked quoted replies in allowlist_quote mode", () => {
    const reply = resolveVisibleWhatsAppReplyContext({
      msg: makeBlockedQuotedReplyMessage("msg-reply-2"),
      mode: "allowlist_quote",
      groupPolicy: "allowlist",
      groupAllowFrom: ["+111"],
    });

    expect(reply).toEqual({
      id: "blocked-reply",
      body: "Blocked quoted text",
      sender: {
        jid: "999@s.whatsapp.net",
        lid: null,
        e164: "+999",
        label: "Mallory (+999)",
      },
    });
  });
});
