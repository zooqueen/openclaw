import { beforeAll, describe, expect, it } from "vitest";
import type {
  AcceptedInboundAccessControlResult,
  InboundAccessControlResult,
} from "./access-control.js";
import {
  readAllowFromStoreMock,
  sendMessageMock,
  getAccessControlTestConfig,
  setAccessControlTestConfig,
  setupAccessControlTestHarness,
  upsertPairingRequestMock,
} from "./access-control.test-harness.js";

setupAccessControlTestHarness();
let checkInboundAccessControl: typeof import("./access-control.js").checkInboundAccessControl;
let resolveWhatsAppCommandAccess: typeof import("../inbound-policy.js").resolveWhatsAppCommandAccess;

beforeAll(async () => {
  ({ checkInboundAccessControl } = await import("./access-control.js"));
  ({ resolveWhatsAppCommandAccess } = await import("../inbound-policy.js"));
});

function expectAccepted(
  result: InboundAccessControlResult,
): asserts result is AcceptedInboundAccessControlResult {
  expect(result.allowed).toBe(true);
  if (!result.allowed) {
    throw new Error("Expected accepted inbound access result");
  }
}

function expectLegacyCompatibilityFields(result: AcceptedInboundAccessControlResult) {
  expect(result.resolvedAccountId).toBe(result.admission.accountId);
  expect(result.isSelfChat).toBe(result.admission.isSelfChat);
  expect("commandAccess" in result).toBe(false);
}

const FORBIDDEN_ADMISSION_POLICY_SURFACES = [
  "config",
  "policy",
  "prompt",
  "context",
  "conversationGroupPolicy",
  "direct",
  "group",
  "tools",
  "toolsBySender",
];

const FORBIDDEN_RESOLVED_POLICY_SURFACES = [
  "account",
  "accounts",
  "cfg",
  "config",
  "context",
  "commandAccess",
  "conversationGroupPolicy",
  "defaultConfig",
  "direct",
  "group",
  "groupConfig",
  "groups",
  "policy",
  "prompt",
  "tools",
  "toolsBySender",
];

function expectNoRawAdmissionPolicySurfaces(admission: Record<string, unknown>) {
  for (const key of FORBIDDEN_ADMISSION_POLICY_SURFACES) {
    expect(admission).not.toHaveProperty(key);
  }
}

function expectResolvedPolicy(admission: Record<string, unknown>): Record<string, unknown> {
  expectNoRawAdmissionPolicySurfaces(admission);
  expect(admission.resolvedPolicy).toBeTypeOf("object");
  const resolvedPolicy = admission.resolvedPolicy as Record<string, unknown>;
  for (const key of FORBIDDEN_RESOLVED_POLICY_SURFACES) {
    expect(resolvedPolicy).not.toHaveProperty(key);
  }
  return resolvedPolicy;
}

function expectCommandProjection(value: unknown, authorized: boolean) {
  expect(value).toEqual(
    expect.objectContaining({
      requested: true,
      authorized,
      shouldBlockControlCommand: expect.any(Boolean),
      reasonCode: expect.any(String),
    }),
  );
}

async function checkUnauthorizedWorkDmSender() {
  return checkInboundAccessControl({
    cfg: getAccessControlTestConfig() as never,
    accountId: "work",
    from: "+15550001111",
    selfE164: "+15550009999",
    senderE164: "+15550001111",
    group: false,
    pushName: "Stranger",
    isFromMe: false,
    sock: { sendMessage: sendMessageMock },
    remoteJid: "15550001111@s.whatsapp.net",
  });
}

function expectSilentlyBlocked(result: { allowed: boolean }) {
  expect(result.allowed).toBe(false);
  expect(upsertPairingRequestMock).not.toHaveBeenCalled();
  expect(sendMessageMock).not.toHaveBeenCalled();
}

async function admitDm(params: {
  cfg: Record<string, unknown>;
  accountId?: string;
  from?: string;
  senderE164?: string;
  selfE164?: string;
}) {
  const senderId = params.from ?? "+15550001111";
  const result = await checkInboundAccessControl({
    cfg: params.cfg as never,
    accountId: params.accountId ?? "work",
    from: senderId,
    selfE164: params.selfE164 ?? "+15550009999",
    senderE164: params.senderE164 ?? senderId,
    group: false,
    pushName: "Sam",
    isFromMe: false,
    sock: { sendMessage: sendMessageMock },
    remoteJid: "15550001111@s.whatsapp.net",
  });
  expectAccepted(result);
  return result.admission;
}

async function checkCommandAccessForDm(params: Parameters<typeof admitDm>[0]) {
  const admission = await admitDm(params);
  return await resolveWhatsAppCommandAccess({
    admission,
    commandBody: "/status",
  });
}

async function admitGroup(params: {
  cfg: Record<string, unknown>;
  accountId?: string;
  from?: string;
  senderE164?: string;
  selfE164?: string;
}) {
  const conversationId = params.from ?? "120363401234567890@g.us";
  const senderId = params.senderE164 ?? "+15550001111";
  const result = await checkInboundAccessControl({
    cfg: params.cfg as never,
    accountId: params.accountId ?? "work",
    from: conversationId,
    selfE164: params.selfE164 ?? "+15550009999",
    senderE164: senderId,
    group: true,
    pushName: "Sam",
    isFromMe: false,
    sock: { sendMessage: sendMessageMock },
    remoteJid: conversationId,
  });
  expectAccepted(result);
  return result.admission;
}

async function checkCommandAccessForGroup(params: Parameters<typeof admitGroup>[0]) {
  const admission = await admitGroup(params);
  return await resolveWhatsAppCommandAccess({
    admission,
    commandBody: "/status",
  });
}

describe("checkInboundAccessControl admission contract", () => {
  it("keeps blocked results on the legacy flat access shape", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          allowFrom: ["+15559999999"],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result).toMatchObject({
      allowed: false,
      shouldMarkRead: false,
      resolvedAccountId: "default",
      isSelfChat: false,
    });
    expect("admission" in result).toBe(false);
    expect("commandAccess" in result).toBe(false);
  });

  it("returns accepted facts through admission while preserving legacy access fields", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          allowFrom: ["+15550001111"],
          groupPolicy: "open",
          groups: {
            "120363401234567890@g.us": { requireMention: true },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expectAccepted(result);
    expectLegacyCompatibilityFields(result);
    expect(result.shouldMarkRead).toBe(true);
    expect(result.admission).toMatchObject({
      account: {
        accountId: "default",
        enabled: true,
        sendReadReceipts: true,
      },
      accountId: "default",
      conversation: {
        groupSessionId: "+15550001111",
        id: "+15550001111",
        kind: "direct",
        requireMention: false,
      },
      isSelfChat: false,
      sender: {
        dmSenderId: "+15550001111",
        id: "+15550001111",
        isDmSenderSamePhone: false,
        isSamePhone: false,
      },
      senderAccess: {
        allowed: true,
        decision: "allow",
        effectiveAllowFrom: ["+15550001111"],
        effectiveGroupAllowFrom: ["+15550001111"],
        providerMissingFallbackApplied: false,
        reasonCode: "dm_policy_allowlisted",
      },
    });
    expectResolvedPolicy(result.admission as Record<string, unknown>);
    expect("direct" in result.admission).toBe(false);
    expect("group" in result.admission).toBe(false);
    expect("cfg" in result.admission).toBe(false);
    expect("state" in result.admission).toBe(false);
    expect("ingress" in result.admission).toBe(false);
    expect("gate" in result.admission.senderAccess).toBe(false);
    expect("routeAccess" in result.admission).toBe(false);
    expect("activationAccess" in result.admission).toBe(false);
    expect("commandAccess" in result.admission).toBe(false);
  });

  it("copies group conversation and context visibility facts into admission", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
          groupAllowFrom: ["+15550001111"],
          groups: {
            "120363401234567890@g.us": { requireMention: true },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "120363401234567890@g.us",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: true,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "120363401234567890@g.us",
    });

    expectAccepted(result);
    expect(result.admission.conversation).toEqual({
      kind: "group",
      id: "120363401234567890@g.us",
      groupSessionId: "120363401234567890@g.us",
      requireMention: true,
    });
    expect(expectResolvedPolicy(result.admission as Record<string, unknown>)).toEqual(
      expect.objectContaining({
        groupPolicy: "allowlist",
        groupAllowFrom: ["+15550001111"],
        requireMention: true,
        groupAllowlist: expect.objectContaining({
          allowlistEnabled: true,
          allowed: true,
        }),
        contextVisibility: expect.objectContaining({
          groupAllowFrom: ["+15550001111"],
        }),
      }),
    );
  });

  it("keeps a stable admitted group sender id when the participant phone is unresolved", async () => {
    const groupJid = "120363401234567890@g.us";
    const participantJid = "999999@lid";
    setAccessControlTestConfig({
      channels: {
        whatsapp: {
          groupPolicy: "open",
        },
      },
    });

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: groupJid,
      selfE164: "+15550009999",
      senderE164: null,
      senderJid: participantJid,
      group: true,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: groupJid,
    });

    expectAccepted(result);
    expect(result.admission.sender.id).toBe(participantJid);
    expect(result.admission.sender.dmSenderId).toBe(groupJid);
  });

  it("exposes downstream-ready resolved policy facts without raw config branches", async () => {
    const groupJid = "120363401234567890@g.us";
    const cfg = {
      channels: {
        whatsapp: {
          name: "Primary",
          dmPolicy: "allowlist",
          allowFrom: ["+15550001111"],
          groupPolicy: "allowlist",
          groupAllowFrom: ["+15550001111"],
          groups: {
            [groupJid]: {
              requireMention: true,
              ingest: false,
              systemPrompt: "group prompt",
              tools: {
                allow: ["message.send"],
                alsoAllow: ["poll"],
                deny: ["exec"],
              },
              toolsBySender: {
                "e164:+15550001111": {
                  allow: ["read"],
                  deny: ["write"],
                },
              },
            },
            "*": {
              systemPrompt: "default group prompt",
              tools: { deny: ["shell"] },
            },
          },
          direct: {
            "+15550001111": { systemPrompt: "direct prompt" },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const groupResult = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: groupJid,
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: true,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: groupJid,
    });
    const directResult = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expectAccepted(groupResult);
    expectAccepted(directResult);
    expect(groupResult.admission.account).toEqual({
      accountId: "default",
      name: "Primary",
      authDir: expect.any(String),
      enabled: true,
      sendReadReceipts: true,
    });
    const groupPolicy = expectResolvedPolicy(groupResult.admission as Record<string, unknown>);
    expect(groupPolicy).toEqual(
      expect.objectContaining({
        dmPolicy: "allowlist",
        groupPolicy: "allowlist",
        configuredAllowFrom: ["+15550001111"],
        dmAllowFrom: ["+15550001111"],
        groupAllowFrom: ["+15550001111"],
        providerMissingFallbackApplied: false,
        requireMention: true,
        systemPrompt: "group prompt",
        groupAllowlist: expect.objectContaining({
          allowlistEnabled: true,
          allowed: true,
        }),
      }),
    );
    expect(groupPolicy).not.toHaveProperty("groupConfig");
    expect(groupPolicy).not.toHaveProperty("defaultConfig");
    expect(groupPolicy).not.toHaveProperty("toolsBySender");
    expect(
      expectResolvedPolicy(directResult.admission as Record<string, unknown>).systemPrompt,
    ).toBe("direct prompt");

    cfg.channels.whatsapp.allowFrom.push("+15550002222");
    cfg.channels.whatsapp.groupAllowFrom.push("+15550003333");
    cfg.channels.whatsapp.groups[groupJid].tools.allow.push("mutated");
    cfg.channels.whatsapp.groups[groupJid].toolsBySender["e164:+15550001111"].deny.push("mutated");
    cfg.channels.whatsapp.direct["+15550001111"].systemPrompt = "mutated";

    expect(groupPolicy.configuredAllowFrom).toEqual(["+15550001111"]);
    expect(groupPolicy.groupAllowFrom).toEqual(["+15550001111"]);
    expect(
      expectResolvedPolicy(directResult.admission as Record<string, unknown>).systemPrompt,
    ).toBe("direct prompt");
  });

  it("resolves direct prompt fallback to a single admitted systemPrompt", async () => {
    const checkDirectPrompt = async (
      direct: Record<string, { systemPrompt?: string }>,
    ): Promise<string | undefined> => {
      setAccessControlTestConfig({
        channels: {
          whatsapp: {
            dmPolicy: "allowlist",
            allowFrom: ["+15550001111"],
            direct,
          },
        },
      });
      const result = await checkInboundAccessControl({
        cfg: getAccessControlTestConfig() as never,
        accountId: "default",
        from: "+15550001111",
        selfE164: "+15550009999",
        senderE164: "+15550001111",
        group: false,
        pushName: "Sam",
        isFromMe: false,
        sock: { sendMessage: sendMessageMock },
        remoteJid: "15550001111@s.whatsapp.net",
      });
      expectAccepted(result);
      return expectResolvedPolicy(result.admission as Record<string, unknown>).systemPrompt as
        | string
        | undefined;
    };

    await expect(checkDirectPrompt({ "*": { systemPrompt: " wildcard " } })).resolves.toBe(
      "wildcard",
    );
    await expect(
      checkDirectPrompt({
        "+15550001111": {},
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBe("wildcard");
    await expect(
      checkDirectPrompt({
        "+15550001111": { systemPrompt: " specific " },
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBe("specific");
    await expect(
      checkDirectPrompt({
        "+15550001111": { systemPrompt: "   " },
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBeUndefined();
  });

  it("does not let raw WhatsApp remote JID direct prompt keys override normalized peer prompts", async () => {
    setAccessControlTestConfig({
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          allowFrom: ["+15550001111"],
          direct: {
            "15550001111@s.whatsapp.net": { systemPrompt: "raw jid prompt" },
            "*": { systemPrompt: "wildcard prompt" },
          },
        },
      },
    });

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expectAccepted(result);
    expect(expectResolvedPolicy(result.admission as Record<string, unknown>).systemPrompt).toBe(
      "wildcard prompt",
    );
  });

  it("resolves group prompt fallback to a single admitted systemPrompt", async () => {
    const groupJid = "120363401234567890@g.us";
    const checkGroupPrompt = async (
      groups: Record<string, { systemPrompt?: string }>,
    ): Promise<string | undefined> => {
      setAccessControlTestConfig({
        channels: {
          whatsapp: {
            groupPolicy: "open",
            groupAllowFrom: ["+15550001111"],
            groups,
          },
        },
      });
      const result = await checkInboundAccessControl({
        cfg: getAccessControlTestConfig() as never,
        accountId: "default",
        from: groupJid,
        selfE164: "+15550009999",
        senderE164: "+15550001111",
        group: true,
        pushName: "Sam",
        isFromMe: false,
        sock: { sendMessage: sendMessageMock },
        remoteJid: groupJid,
      });
      expectAccepted(result);
      return expectResolvedPolicy(result.admission as Record<string, unknown>).systemPrompt as
        | string
        | undefined;
    };

    await expect(checkGroupPrompt({ "*": { systemPrompt: " wildcard " } })).resolves.toBe(
      "wildcard",
    );
    await expect(
      checkGroupPrompt({
        [groupJid]: {},
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBe("wildcard");
    await expect(
      checkGroupPrompt({
        [groupJid]: { systemPrompt: " specific " },
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBe("specific");
    await expect(
      checkGroupPrompt({
        [groupJid]: { systemPrompt: "   " },
        "*": { systemPrompt: " wildcard " },
      }),
    ).resolves.toBeUndefined();
  });

  it("carries provider fallback diagnostics from policy into admission sender access", async () => {
    const cfg = {};
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550009999",
      selfE164: "+15550009999",
      senderE164: "+15550009999",
      group: false,
      pushName: "Owner",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550009999@s.whatsapp.net",
    });

    expectAccepted(result);
    expect(
      expectResolvedPolicy(result.admission as Record<string, unknown>)
        .providerMissingFallbackApplied,
    ).toBe(true);
    expect(result.admission.senderAccess.providerMissingFallbackApplied).toBe(true);
  });

  it("records same-phone facts without broadening the accepted result", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          allowFrom: ["+15550009999"],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550009999",
      selfE164: "+15550009999",
      senderE164: "+15550009999",
      group: false,
      pushName: "Owner",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550009999@s.whatsapp.net",
    });

    expectAccepted(result);
    expect(result.admission.sender).toEqual({
      id: "+15550009999",
      dmSenderId: "+15550009999",
      isSamePhone: true,
      isDmSenderSamePhone: true,
    });
    expectLegacyCompatibilityFields(result);
  });

  it("preserves account-level policy precedence in accepted admissions", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "disabled",
          accounts: {
            work: {
              dmPolicy: "allowlist",
              allowFrom: ["+15550001111"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "work",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expectAccepted(result);
    expect(result.admission.accountId).toBe("work");
    expect(expectResolvedPolicy(result.admission as Record<string, unknown>).dmPolicy).toBe(
      "allowlist",
    );
    expect(result.admission.senderAccess.reasonCode).toBe("dm_policy_allowlisted");
  });
});

describe("checkInboundAccessControl pairing grace", () => {
  async function runPairingGraceCase(messageTimestampMs: number) {
    const connectedAtMs = 1_000_000;
    return await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      messageTimestampMs,
      connectedAtMs,
      pairingGraceMs: 30_000,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });
  }

  it("suppresses pairing replies for historical DMs on connect", async () => {
    const result = await runPairingGraceCase(1_000_000 - 31_000);

    expect(result.allowed).toBe(false);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("sends pairing replies for live DMs", async () => {
    const result = await runPairingGraceCase(1_000_000 - 10_000);

    expect(result.allowed).toBe(false);
    expect(upsertPairingRequestMock).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalled();
  });
});

describe("WhatsApp dmPolicy precedence", () => {
  it("uses account-level dmPolicy instead of channel-level (#8736)", async () => {
    // Channel-level says "pairing" but the account-level says "allowlist".
    // The account-level override should take precedence, so an unauthorized
    // sender should be blocked silently (no pairing reply).
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          accounts: {
            work: {
              dmPolicy: "allowlist",
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkUnauthorizedWorkDmSender();
    expectSilentlyBlocked(result);
  });

  it("inherits channel-level dmPolicy when account-level dmPolicy is unset", async () => {
    // Account has allowFrom set, but no dmPolicy override. Should inherit the channel default.
    // With dmPolicy=allowlist, unauthorized senders are silently blocked.
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkUnauthorizedWorkDmSender();
    expectSilentlyBlocked(result);
  });

  it("does not merge persisted pairing approvals in allowlist mode", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);
    readAllowFromStoreMock.mockResolvedValue(["+15550001111"]);

    const result = await checkUnauthorizedWorkDmSender();

    expectSilentlyBlocked(result);
    expect(readAllowFromStoreMock).not.toHaveBeenCalled();
  });

  it("always allows same-phone DMs even when allowFrom is restrictive", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          allowFrom: ["+15550001111"],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550009999",
      selfE164: "+15550009999",
      senderE164: "+15550009999",
      group: false,
      pushName: "Owner",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550009999@s.whatsapp.net",
    });
    const commandAccess = await checkCommandAccessForDm({
      cfg,
      accountId: "default",
      from: "+15550009999",
      senderE164: "+15550009999",
      selfE164: "+15550009999",
    });

    expect(result.allowed).toBe(true);
    expectCommandProjection(commandAccess, true);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("allows DMs from generic message sender access groups", async () => {
    const cfg = {
      accessGroups: {
        owners: {
          type: "message.senders",
          members: {
            whatsapp: ["+15550001111"],
          },
        },
      },
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["accessGroup:owners"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "work",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });
    const commandAccess = await checkCommandAccessForDm({ cfg });

    expect(result.allowed).toBe(true);
    expectCommandProjection(commandAccess, true);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("authorizes DM commands from admission-time command policy after current config changes", async () => {
    const cfg = {
      commands: {
        useAccessGroups: false,
      },
      accessGroups: {
        owners: {
          type: "message.senders",
          members: {
            whatsapp: ["+15550009999"],
          },
        },
      },
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["+15550001111"],
            },
          },
        },
      },
    };

    const admission = await admitDm({ cfg, accountId: "work" });
    cfg.commands.useAccessGroups = true;
    cfg.channels.whatsapp.accounts.work.allowFrom = ["accessGroup:owners"];

    const commandAccess = await resolveWhatsAppCommandAccess({
      admission,
      commandBody: "/status",
    });

    expectCommandProjection(commandAccess, true);
  });

  it("preserves authorization for caller-detected configured command bodies", async () => {
    const cfg = {
      commands: {
        useAccessGroups: false,
      },
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          accounts: {
            work: {
              allowFrom: ["+15550001111"],
            },
          },
        },
      },
    };

    const admission = await admitDm({ cfg, accountId: "work" });

    const commandAccess = await resolveWhatsAppCommandAccess({
      admission,
      commandBody: "status",
    });

    expectCommandProjection(commandAccess, true);
  });

  it("allows group messages from generic message sender access groups", async () => {
    const cfg = {
      accessGroups: {
        operators: {
          type: "message.senders",
          members: {
            whatsapp: ["+15550001111"],
          },
        },
      },
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
          groupAllowFrom: ["accessGroup:operators"],
          accounts: {
            work: {
              allowFrom: ["+15559999999"],
            },
          },
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "work",
      from: "120363401234567890@g.us",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: true,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "120363401234567890@g.us",
    });
    const commandAccess = await checkCommandAccessForGroup({ cfg });

    expect(result.allowed).toBe(true);
    expectCommandProjection(commandAccess, true);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("falls back from empty groupAllowFrom to allowFrom for group allowlists", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "allowlist",
          groupPolicy: "allowlist",
          allowFrom: ["+15550001111"],
          groupAllowFrom: [],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "120363401234567890@g.us",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: true,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "120363401234567890@g.us",
    });
    const commandAccess = await checkCommandAccessForGroup({
      cfg,
      accountId: "default",
    });

    expect(result.allowed).toBe(true);
    expectCommandProjection(commandAccess, true);
    expect(upsertPairingRequestMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("does not broaden self-chat mode to every paired DM when allowFrom is empty", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          allowFrom: [],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550001111",
      selfE164: "+15550009999",
      senderE164: "+15550001111",
      group: false,
      pushName: "Sam",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550001111@s.whatsapp.net",
    });

    expect(result).toMatchObject({
      allowed: false,
      isSelfChat: false,
      resolvedAccountId: "default",
    });
  });

  it("treats same-phone DMs as self-chat only when explicitly configured", async () => {
    const cfg = {
      channels: {
        whatsapp: {
          dmPolicy: "pairing",
          allowFrom: ["+15550009999"],
        },
      },
    };
    setAccessControlTestConfig(cfg);

    const result = await checkInboundAccessControl({
      cfg: getAccessControlTestConfig() as never,
      accountId: "default",
      from: "+15550009999",
      selfE164: "+15550009999",
      senderE164: "+15550009999",
      group: false,
      pushName: "Owner",
      isFromMe: false,
      sock: { sendMessage: sendMessageMock },
      remoteJid: "15550009999@s.whatsapp.net",
    });

    expectAccepted(result);
    expect(result.admission.isSelfChat).toBe(true);
  });
});
