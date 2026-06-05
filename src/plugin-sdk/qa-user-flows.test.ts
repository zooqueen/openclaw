import { describe, expect, it } from "vitest";
import {
  collectQaUserFlowCapabilities,
  collectQaUserFlowSupportedFlowIds,
  planQaStandardUserFlows,
  planQaUserFlows,
} from "./qa-user-flows.js";

describe("plugin-sdk qa-user-flows", () => {
  it("plans flows from optional owner mappings without requiring every plugin to map everything", () => {
    const mappings = [
      {
        ownerId: "qa-channel",
        provides: ["messaging.inbound-message", "messaging.outbound-final-reply"],
        supportedFlowIds: ["messaging.direct-reply"],
      },
      {
        ownerId: "openai",
        provides: ["model.final-response"],
      },
    ] as const;

    expect(collectQaUserFlowCapabilities(mappings)).toEqual([
      "messaging.inbound-message",
      "messaging.outbound-final-reply",
      "model.final-response",
    ]);
    expect(collectQaUserFlowSupportedFlowIds(mappings)).toEqual(["messaging.direct-reply"]);

    const plan = planQaStandardUserFlows({
      mappings,
      requestedFlowIds: ["messaging.direct-reply", "tool.call-followthrough"],
    });

    expect(plan.selected.map((flow) => flow.id)).toEqual(["messaging.direct-reply"]);
    expect(
      plan.skipped.map((flow) => ({
        id: flow.id,
        reason: flow.reason,
        missingCapabilities: flow.missingCapabilities,
      })),
    ).toContainEqual({
      id: "tool.call-followthrough",
      reason: "driver-not-implemented",
      missingCapabilities: ["tool.call"],
    });
    expect(plan.selected[0]).toMatchObject({
      execution: { runner: "qa-lab-flow", target: "running-gateway" },
      requiredCapabilities: ["messaging.inbound-message", "messaging.outbound-final-reply"],
    });
  });

  it("uses live-transport mappings for channel-native user flows that do not have QA Lab markdown yet", () => {
    const plan = planQaStandardUserFlows({
      availableCapabilities: [
        "messaging.inbound-message",
        "messaging.mention-gating",
        "messaging.outbound-final-reply",
        "setup.native-help-command",
      ],
      requestedFlowIds: ["messaging.mention-gating", "setup.native-help-command"],
    });

    expect(
      plan.selected.map((flow) => ({
        execution: flow.execution,
        id: flow.id,
      })),
    ).toEqual([
      {
        id: "messaging.mention-gating",
        execution: { runner: "live-transport", target: "running-gateway" },
      },
      {
        id: "setup.native-help-command",
        execution: { runner: "live-transport", target: "running-gateway" },
      },
    ]);
  });

  it("keeps generic planner id validation and skip ordering shared", () => {
    const flows = [
      {
        id: "alpha",
        title: "Alpha",
        description: "Alpha flow",
        execution: { runner: "qa-lab-flow", target: "running-gateway" },
        surface: "messaging",
        action: { actor: "user", verb: "send", object: "message" },
        requiredCapabilities: ["cap.alpha"],
      },
      {
        id: "beta",
        title: "Beta",
        description: "Beta flow",
        execution: { runner: "qa-lab-flow", target: "running-gateway" },
        surface: "tool",
        action: { actor: "user", verb: "request", object: "tool" },
        requiredCapabilities: ["cap.beta"],
      },
    ] as const;

    expect(() =>
      planQaUserFlows({
        flows,
        availableCapabilities: [],
        requestedFlowIds: ["missing"],
      }),
    ).toThrow("unknown QA user flow id: missing");

    const plan = planQaUserFlows({
      flows,
      availableCapabilities: ["cap.beta"],
      driverSupportedFlowIds: ["beta"],
      requestedFlowIds: ["beta"],
    });

    expect(plan.selected.map((flow) => flow.id)).toEqual(["beta"]);
    expect(plan.skipped.map((flow) => [flow.id, flow.reason, flow.missingCapabilities])).toEqual([
      ["alpha", "not-requested", ["cap.alpha"]],
    ]);
  });
});
