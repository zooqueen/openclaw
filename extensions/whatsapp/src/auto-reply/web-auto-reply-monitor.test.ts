import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-contracts";
import { resolveAgentRoute } from "openclaw/plugin-sdk/routing";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkInboundAccessControl } from "../inbound/access-control.js";
import { createTestWebInboundMessage } from "../inbound/admission.test-support.js";
import type { WhatsAppSendResult } from "../inbound/send-result.js";
import type { WebInboundMessage } from "../inbound/types.js";
import { buildMentionConfig } from "./mentions.js";
import { applyGroupGating, type GroupHistoryEntry } from "./monitor/group-gating.js";
import { formatWhatsAppInboundListeningLog } from "./monitor/listener-log.js";
import { buildInboundLine, formatReplyContext } from "./monitor/message-line.js";

let sessionDir: string | undefined;
let sessionStorePath: string;

function acceptedSendResult(kind: "media" | "text", id: string): WhatsAppSendResult {
  return {
    kind,
    messageId: id,
    keys: [{ id }],
    providerAccepted: true,
  };
}

beforeEach(async () => {
  sessionDir = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-group-gating-"));
  sessionStorePath = path.join(sessionDir, "sessions.json");
  await fs.writeFile(sessionStorePath, "{}");
});

afterEach(async () => {
  if (sessionDir) {
    await fs.rm(sessionDir, { recursive: true, force: true });
    sessionDir = undefined;
  }
});

const makeConfig = (overrides: Record<string, unknown>) =>
  ({
    channels: {
      whatsapp: {
        groupPolicy: "open",
        groups: { "*": { requireMention: true } },
      },
    },
    session: { store: sessionStorePath },
    ...overrides,
  }) as unknown as OpenClawConfig;

async function runGroupGating(params: {
  cfg: OpenClawConfig;
  msg: WebInboundMessage;
  conversationId?: string;
  agentId?: string;
  selfChatMode?: boolean;
  authDir?: string;
}) {
  const groupHistories = new Map<string, GroupHistoryEntry[]>();
  const conversationId = params.conversationId ?? "123@g.us";
  const agentId = params.agentId ?? "main";
  const sessionKey = `agent:${agentId}:whatsapp:group:${conversationId}`;
  const baseMentionConfig = buildMentionConfig(params.cfg, undefined);
  const verboseLogs: string[] = [];
  const msg = params.msg;
  const result = await applyGroupGating({
    cfg: params.cfg,
    msg,
    groupHistoryKey: `whatsapp:default:group:${conversationId}`,
    agentId,
    sessionKey,
    baseMentionConfig,
    authDir: params.authDir,
    selfChatMode: params.selfChatMode,
    groupHistories,
    groupHistoryLimit: 10,
    groupMemberNames: new Map(),
    logVerbose: (message) => verboseLogs.push(message),
    replyLogger: { debug: () => {}, warn: () => {} },
  });
  return { result, groupHistories, verboseLogs };
}

type TestAdmissionOverrides = NonNullable<
  NonNullable<Parameters<typeof createTestWebInboundMessage>[0]>["admissionOverrides"]
>;

function createGroupAdmission(overrides: TestAdmissionOverrides = {}): TestAdmissionOverrides {
  return {
    chatType: "group",
    conversationId: "123@g.us",
    requireMention: true,
    ...overrides,
  };
}

type GroupMessageOverrides = {
  admission?: WebInboundMessage["admission"];
  id?: string;
  conversationId?: string;
  to?: string;
  accountId?: string;
  body?: string;
  timestamp?: number;
  senderE164?: string;
  senderJid?: string;
  senderName?: string;
  selfJid?: string | null;
  selfE164?: string | null;
  mentionedJids?: string[];
  replyToId?: string;
  replyToBody?: string;
  replyToSender?: string;
  replyToSenderJid?: string;
  replyToSenderE164?: string;
  admissionOverrides?: TestAdmissionOverrides;
};

function createGroupMessage(overrides: GroupMessageOverrides = {}): WebInboundMessage {
  const accountId = overrides.accountId ?? overrides.admissionOverrides?.accountId ?? "default";
  const conversationId = overrides.conversationId ?? "123@g.us";
  const senderE164 = overrides.senderE164 ?? overrides.admissionOverrides?.senderId ?? "+111";
  const message = createTestWebInboundMessage({
    admissionOverrides: createGroupAdmission({
      accountId,
      conversationId,
      senderId: senderE164,
      ...overrides.admissionOverrides,
    }),
    event: {
      id: overrides.id ?? "g1",
      timestamp: overrides.timestamp,
    },
    payload: {
      body: overrides.body ?? "hello group",
    },
    group: {
      mentions: overrides.mentionedJids ? { jids: overrides.mentionedJids } : undefined,
    },
    platform: {
      recipientJid: overrides.to ?? "+2",
      sender: overrides.senderName ? { name: overrides.senderName } : undefined,
      senderJid: overrides.senderJid,
      senderName: overrides.senderName ?? "Alice",
      selfJid: overrides.selfJid,
      selfE164: overrides.selfE164 ?? "+999",
      sendComposing: async () => {},
      reply: async (_text, _options) => acceptedSendResult("text", "r1"),
      sendMedia: async (_payload, _options) => acceptedSendResult("media", "m1"),
    },
    quote:
      overrides.replyToId || overrides.replyToBody || overrides.replyToSender
        ? {
            id: overrides.replyToId,
            body: overrides.replyToBody,
            sender: {
              displayName: overrides.replyToSender,
              jid: overrides.replyToSenderJid,
              e164: overrides.replyToSenderE164,
            },
          }
        : undefined,
  });
  return overrides.admission ? { ...message, admission: overrides.admission } : message;
}

async function admitGroupMessage(params: {
  cfg: OpenClawConfig;
  accountId?: string;
  conversationId?: string;
  senderE164?: string | null;
  senderJid?: string | null;
  senderName?: string;
  selfE164?: string | null;
}): Promise<WebInboundMessage["admission"]> {
  const conversationId = params.conversationId ?? "123@g.us";
  const result = await checkInboundAccessControl({
    cfg: params.cfg,
    accountId: params.accountId ?? "default",
    from: conversationId,
    selfE164: params.selfE164 ?? "+15551234567",
    senderE164: params.senderE164 ?? "+111",
    senderJid: params.senderJid,
    group: true,
    pushName: params.senderName ?? "Alice",
    isFromMe: false,
    sock: { sendMessage: async () => undefined },
    remoteJid: conversationId,
  });
  if (!result.allowed) {
    throw new Error(`Expected admitted WhatsApp group message for ${conversationId}`);
  }
  return result.admission;
}

function makeOwnerGroupConfig() {
  return makeConfig({
    channels: {
      whatsapp: {
        allowFrom: ["+111"],
        groups: { "*": { requireMention: true } },
      },
    },
  });
}

function makeInboundCfg(messagePrefix = "") {
  return {
    agents: { defaults: { workspace: "/tmp/openclaw" } },
    channels: { whatsapp: { messagePrefix } },
  } as never;
}

describe("WhatsApp listener diagnostics", () => {
  it("describes WhatsApp inbound listener scope without implying DM-only routing", () => {
    expect(
      formatWhatsAppInboundListeningLog({
        groupPolicy: "open",
        hasGroupAllowFrom: false,
      }),
    ).toBe(
      "Listening for WhatsApp inbound messages (DM + all groups; no group allowlist configured).",
    );
    expect(
      formatWhatsAppInboundListeningLog({
        groupPolicy: "disabled",
        hasGroupAllowFrom: true,
      }),
    ).toBe("Listening for WhatsApp inbound messages (DM + groups disabled by groupPolicy).");
    expect(
      formatWhatsAppInboundListeningLog({
        groupPolicy: "allowlist",
        hasGroupAllowFrom: false,
      }),
    ).toBe(
      "Listening for WhatsApp inbound messages (DM + group inbound blocked by empty groupPolicy allowlist).",
    );
    expect(
      formatWhatsAppInboundListeningLog({
        groupPolicy: "allowlist",
        hasGroupAllowFrom: true,
      }),
    ).toBe(
      "Listening for WhatsApp inbound messages (DM + all groups; sender allowlist configured).",
    );
    expect(
      formatWhatsAppInboundListeningLog({
        groups: { "123@g.us": {}, "*": {} },
        groupPolicy: "allowlist",
        hasGroupAllowFrom: true,
      }),
    ).toBe("Listening for WhatsApp inbound messages (DM + all groups; wildcard configured).");
    expect(
      formatWhatsAppInboundListeningLog({
        groups: { "123@g.us": {}, "456@g.us": {} },
        groupPolicy: "allowlist",
        hasGroupAllowFrom: true,
      }),
    ).toBe("Listening for WhatsApp inbound messages (DM + 2 configured groups).");
  });
});

describe("applyGroupGating", () => {
  it("treats reply-to-bot as implicit mention", async () => {
    const cfg = makeConfig({});
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        id: "m1",
        to: "+15550000",
        accountId: "default",
        body: "following up",
        timestamp: Date.now(),
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
        replyToId: "m0",
        replyToBody: "bot said hi",
        replyToSender: "+15551234567",
        replyToSenderJid: "15551234567@s.whatsapp.net",
        replyToSenderE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("does not treat self-number quoted replies as implicit mention in selfChatMode groups", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          selfChatMode: true,
          groupPolicy: "open",
          groups: { "*": { requireMention: true } },
        },
      },
    });
    const { result } = await runGroupGating({
      cfg,
      selfChatMode: true,
      msg: createGroupMessage({
        id: "m-self-reply",
        to: "+15550000",
        accountId: "default",
        body: "following up on my own message",
        timestamp: Date.now(),
        senderE164: "+15551234567",
        senderJid: "15551234567@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
        replyToId: "m0",
        replyToBody: "my earlier message",
        replyToSender: "+15551234567",
        replyToSenderJid: "15551234567@s.whatsapp.net",
        replyToSenderE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(false);
  });

  it("still treats reply-to-bot as implicit mention in selfChatMode when sender is a different user", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          selfChatMode: true,
          groupPolicy: "open",
          groups: { "*": { requireMention: true } },
        },
      },
    });
    const { result } = await runGroupGating({
      cfg,
      selfChatMode: true,
      msg: createGroupMessage({
        id: "m-other-reply",
        to: "+15550000",
        accountId: "default",
        body: "following up on bot reply",
        timestamp: Date.now(),
        senderE164: "+15559999999",
        senderJid: "15559999999@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
        replyToId: "m0",
        replyToBody: "bot earlier response",
        replyToSender: "+15551234567",
        replyToSenderJid: "15551234567@s.whatsapp.net",
        replyToSenderE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("processes explicit group @mentions when self is in allowFrom (#49317)", async () => {
    if (!sessionDir) {
      throw new Error("sessionDir not initialized");
    }
    await fs.writeFile(
      path.join(sessionDir, "lid-mapping-216372600647751_reverse.json"),
      JSON.stringify("+15551234567"),
    );
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["+15551234567"],
          groupPolicy: "open",
          groups: { "*": { requireMention: true } },
        },
      },
    });
    const msg = createGroupMessage({
      id: "g-self-lid-mention",
      accountId: "default",
      body: "@216372600647751 can you see this?",
      mentionedJids: ["216372600647751@lid"],
      senderE164: "+15550001111",
      senderName: "Alice",
      selfE164: "+15551234567",
      selfJid: "15551234567@s.whatsapp.net",
    });

    const { result, groupHistories } = await runGroupGating({
      cfg,
      authDir: sessionDir,
      msg,
    });

    expect(result.shouldProcess).toBe(true);
    expect(result.mention.effectiveWasMentioned).toBe(true);
    expect(groupHistories.get("whatsapp:default:group:123@g.us")).toBeUndefined();
  });

  it("honors per-account selfChatMode overrides before suppressing implicit mentions", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          selfChatMode: true,
          groupPolicy: "open",
          groups: { "*": { requireMention: true } },
          accounts: {
            work: {
              selfChatMode: false,
            },
          },
        },
      },
    });
    // Per-account override: work account has selfChatMode: false despite root being true
    const { result } = await runGroupGating({
      cfg,
      selfChatMode: false,
      msg: createGroupMessage({
        id: "m-account-override",
        to: "+15550000",
        accountId: "work",
        body: "following up on bot reply",
        timestamp: Date.now(),
        senderE164: "+15551234567",
        senderJid: "15551234567@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
        replyToId: "m0",
        replyToBody: "bot earlier response",
        replyToSender: "+15551234567",
        replyToSenderJid: "15551234567@s.whatsapp.net",
        replyToSenderE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("uses account-scoped groupPolicy and groupAllowFrom for named-account group gating", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          groupPolicy: "allowlist",
          accounts: {
            work: {
              groupPolicy: "allowlist",
              groupAllowFrom: ["+111"],
            },
          },
        },
      },
    });

    const admission = await admitGroupMessage({
      cfg,
      accountId: "work",
      senderE164: "+111",
      senderJid: "111@s.whatsapp.net",
      selfE164: "+15551234567",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id: "g-account-policy",
        body: "following up",
        senderE164: "+111",
        senderJid: "111@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
        replyToId: "m0",
        replyToBody: "bot said hi",
        replyToSender: "+15551234567",
        replyToSenderJid: "15551234567@s.whatsapp.net",
        replyToSenderE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("inherits group gating defaults from accounts.default for named accounts", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          groupPolicy: "allowlist",
          accounts: {
            default: {
              groupPolicy: "open",
              groups: {
                "*": {
                  requireMention: false,
                },
              },
            },
            work: {},
          },
        },
      },
    });

    const admission = await admitGroupMessage({
      cfg,
      accountId: "work",
      senderE164: "+111",
      senderJid: "111@s.whatsapp.net",
      selfE164: "+15551234567",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id: "g-default-inheritance",
        body: "plain group message",
        senderE164: "+111",
        senderJid: "111@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("preserves allowFrom fallback for named-account group gating when groupAllowFrom is empty", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          groupPolicy: "allowlist",
          accounts: {
            work: {
              groupPolicy: "allowlist",
              allowFrom: ["+111"],
              groupAllowFrom: [],
              groups: {
                "*": {
                  requireMention: false,
                },
              },
            },
          },
        },
      },
    });

    const admission = await admitGroupMessage({
      cfg,
      accountId: "work",
      senderE164: "+111",
      senderJid: "111@s.whatsapp.net",
      selfE164: "+15551234567",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id: "g-empty-group-allow-fallback",
        body: "plain group message",
        senderE164: "+111",
        senderJid: "111@s.whatsapp.net",
        selfJid: "15551234567@s.whatsapp.net",
        selfE164: "+15551234567",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("uses account-scoped allowFrom when bypassing mention gating for owner commands", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["+999"],
          accounts: {
            work: {
              allowFrom: ["+111"],
            },
          },
        },
      },
    });

    const admission = await admitGroupMessage({
      cfg,
      accountId: "work",
      senderE164: "+111",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id: "g-account-owner",
        body: "/new",
        senderE164: "+111",
        senderName: "Owner",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("does not treat group mention gating as self-chat under implicit self fallback", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          groups: { "*": { requireMention: true } },
        },
      },
      messages: { groupChat: { mentionPatterns: ["@openclaw"] } },
    });

    const { result, groupHistories } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        id: "g-other-mention",
        body: "@openclaw please check this",
        mentionedJids: ["15550000000@s.whatsapp.net"],
        selfE164: "+15551234567",
        selfJid: "15551234567@s.whatsapp.net",
      }),
    });

    expect(result.shouldProcess).toBe(false);
    expect(groupHistories.get("whatsapp:default:group:123@g.us")?.length).toBe(1);
  });

  it.each([
    { id: "g-new", command: "/new" },
    { id: "g-status", command: "/status" },
  ])("bypasses mention gating for owner $command in group chats", async ({ id, command }) => {
    const cfg = makeOwnerGroupConfig();
    const admission = await admitGroupMessage({
      cfg,
      senderE164: "+111",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id,
        body: command,
        senderE164: "+111",
        senderName: "Owner",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("lets command authorization handle non-owner commands in active groups", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          groups: { "*": { requireMention: false } },
        },
      },
      commands: { useAccessGroups: false },
    });
    const admission = await admitGroupMessage({
      cfg,
      senderE164: "+111",
    });

    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        id: "g-status-non-owner",
        body: "/status",
        senderE164: "+111",
        senderName: "Member",
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("does not bypass mention gating for non-owner /new in group chats", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["+999"],
          groups: { "*": { requireMention: true } },
        },
      },
    });

    const { result, groupHistories } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        id: "g-new-unauth",
        body: "/new",
        senderE164: "+111",
        senderName: "NotOwner",
      }),
    });

    expect(result.shouldProcess).toBe(false);
    expect(groupHistories.get("whatsapp:default:group:123@g.us")?.length).toBe(1);
  });

  it("uses per-agent mention patterns for group gating (routing + mentionPatterns)", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["*"],
          groups: { "*": { requireMention: true } },
        },
      },
      messages: {
        groupChat: { mentionPatterns: ["@global"] },
      },
      agents: {
        list: [
          {
            id: "work",
            groupChat: { mentionPatterns: ["@workbot"] },
          },
        ],
      },
      bindings: [
        {
          agentId: "work",
          match: {
            provider: "whatsapp",
            peer: { kind: "group", id: "123@g.us" },
          },
        },
      ],
    });

    const route = resolveAgentRoute({
      cfg,
      channel: "whatsapp",
      peer: { kind: "group", id: "123@g.us" },
    });
    expect(route.agentId).toBe("work");

    const { result: globalMention } = await runGroupGating({
      cfg,
      agentId: route.agentId,
      msg: createGroupMessage({
        id: "g1",
        body: "@global ping",
        senderE164: "+111",
        senderName: "Alice",
      }),
    });
    expect(globalMention.shouldProcess).toBe(false);

    const { result: workMention } = await runGroupGating({
      cfg,
      agentId: route.agentId,
      msg: createGroupMessage({
        id: "g2",
        body: "@workbot ping",
        senderE164: "+222",
        senderName: "Bob",
      }),
    });
    expect(workMention.shouldProcess).toBe(true);
  });

  it("allows group messages when whatsapp groups default disables mention gating", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["*"],
          groups: { "*": { requireMention: false } },
        },
      },
      messages: { groupChat: { mentionPatterns: ["@openclaw"] } },
    });

    const admission = await admitGroupMessage({
      cfg,
      senderE164: "+111",
    });
    const { result } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
      }),
    });

    expect(result.shouldProcess).toBe(true);
  });

  it("blocks group messages when whatsapp groups is set without a wildcard", async () => {
    const cfg = makeConfig({
      channels: {
        whatsapp: {
          allowFrom: ["*"],
          groups: {
            "999@g.us": { requireMention: false },
          },
        },
      },
    });

    const admission = await admitGroupMessage({
      cfg,
      senderE164: "+111",
      selfE164: "+999",
    });
    const { result, verboseLogs } = await runGroupGating({
      cfg,
      msg: createGroupMessage({
        admission,
        body: "@workbot ping",
        mentionedJids: ["999@s.whatsapp.net"],
        selfJid: "999@s.whatsapp.net",
      }),
    });

    expect(result.shouldProcess).toBe(false);
    expect(verboseLogs).toContain(
      'Dropping message from unregistered WhatsApp group 123@g.us. Add the group JID to channels.whatsapp.groups, or add "*" there to admit all groups. Sender authorization still applies.',
    );
  });
});

describe("buildInboundLine", () => {
  it("prefixes group messages with sender", () => {
    const line = buildInboundLine({
      cfg: makeInboundCfg(""),
      agentId: "main",
      msg: createGroupMessage({
        to: "+15550009999",
        accountId: "default",
        body: "ping",
        timestamp: 1700000000000,
        senderJid: "111@s.whatsapp.net",
        senderE164: "+15550001111",
        senderName: "Bob",
      }) as never,
    });

    expect(line).toContain("Bob (+15550001111):");
    expect(line).toContain("ping");
  });

  it("includes reply-to context blocks when replyToBody is present", () => {
    const line = buildInboundLine({
      cfg: makeInboundCfg(""),
      agentId: "main",
      msg: createTestWebInboundMessage({
        admissionOverrides: {
          chatType: "direct",
          conversationId: "+1555",
          senderId: "+1555",
          dmSenderId: "+1555",
        },
        platform: {
          recipientJid: "+1555",
        },
        payload: {
          body: "hello",
        },
        quote: {
          id: "q1",
          body: "original",
          sender: { displayName: "+1999" },
        },
      }),
      envelope: { includeTimestamp: false },
    });

    expect(line).toContain("[Replying to +1999 id:q1]");
    expect(line).toContain("original");
    expect(line).toContain("[/Replying]");
  });

  it("applies the WhatsApp messagePrefix when configured", () => {
    const line = buildInboundLine({
      cfg: makeInboundCfg("[PFX]"),
      agentId: "main",
      msg: createTestWebInboundMessage({
        admissionOverrides: {
          chatType: "direct",
          conversationId: "+1555",
          senderId: "+1555",
          dmSenderId: "+1555",
        },
        platform: {
          recipientJid: "+2666",
        },
        payload: {
          body: "ping",
        },
      }),
      envelope: { includeTimestamp: false },
    });

    expect(line).toContain("[PFX] ping");
  });

  it("normalizes direct from labels by stripping whatsapp: prefix", () => {
    const line = buildInboundLine({
      cfg: makeInboundCfg(""),
      agentId: "main",
      msg: {
        ...createTestWebInboundMessage({
          admissionOverrides: {
            chatType: "direct",
            conversationId: "whatsapp:+15550001111",
            senderId: "+15550001111",
            dmSenderId: "+15550001111",
          },
          platform: {
            recipientJid: "+2666",
            chatJid: "mutable-sender",
          },
          payload: {
            body: "ping",
          },
        }),
      } satisfies WebInboundMessage,
      envelope: { includeTimestamp: false },
    });

    expect(line).toContain("+15550001111");
    expect(line).not.toContain("whatsapp:+15550001111");
    expect(line).not.toContain("mutable-sender");
  });
});

describe("formatReplyContext", () => {
  it("returns null when replyToBody is missing", () => {
    expect(formatReplyContext(createTestWebInboundMessage())).toBeNull();
  });

  it("normalizes quoted sender identity with the admitted account authDir", async () => {
    if (!sessionDir) {
      throw new Error("expected temp session dir");
    }
    await fs.writeFile(
      path.join(sessionDir, "lid-mapping-456_reverse.json"),
      JSON.stringify("5559876"),
    );

    expect(
      formatReplyContext(
        createTestWebInboundMessage({
          admissionOverrides: {
            account: {
              authDir: sessionDir,
            },
          },
          quote: {
            id: "q1",
            body: "original",
            sender: {
              jid: "456@lid",
            },
          },
        }),
      ),
    ).toBe("[Replying to +5559876 id:q1]\noriginal\n[/Replying]");
  });

  it("uses unknown sender label when reply sender is absent", () => {
    expect(
      formatReplyContext(
        createTestWebInboundMessage({
          quote: {
            body: "original",
          },
        }),
      ),
    ).toBe("[Replying to unknown sender]\noriginal\n[/Replying]");
  });
});
