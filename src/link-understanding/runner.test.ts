// Link-understanding runner tests cover bounded fetches, command execution, scoping, and template behavior.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MsgContext } from "../auto-reply/templating.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import type { LinkModelConfig } from "../config/types.tools.js";
import { runCommandWithTimeout } from "../process/exec.js";
import { runLinkUnderstanding } from "./runner.js";

const mocks = vi.hoisted(() => ({
  runCommandWithTimeout: vi.fn(),
}));

vi.mock("../process/exec.js", async () => {
  const actual = await vi.importActual<typeof import("../process/exec.js")>("../process/exec.js");
  return {
    ...actual,
    runCommandWithTimeout: mocks.runCommandWithTimeout,
  };
});

function cfg(entry: LinkModelConfig) {
  return {
    tools: {
      links: {
        enabled: true,
        models: [entry],
      },
    },
  } as OpenClawConfig;
}

function ctx(body: string): MsgContext {
  return { Body: body } as MsgContext;
}

function mockFetchResponse(body = "fetched content", finalUrl = "https://example.com/final") {
  const response = new Response(body, {
    headers: { "Content-Type": "text/plain" },
  });
  Object.defineProperty(response, "url", { value: finalUrl });
  vi.mocked(globalThis.fetch).mockResolvedValueOnce(response);
}

function mockCommand(stdout = "summary") {
  mocks.runCommandWithTimeout.mockResolvedValueOnce({
    code: 0,
    killed: false,
    signal: null,
    stderr: "",
    stdout,
    termination: "exit",
  });
}

describe("runLinkUnderstanding", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    mocks.runCommandWithTimeout.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fetches links before passing bounded content to CLI stdin", async () => {
    mockFetchResponse("page body", "https://example.com/final");
    mockCommand("summarized page");

    const result = await runLinkUnderstanding({
      cfg: cfg({ type: "cli", command: "summarize", args: ["--source", "{{LinkUrl}}"] }),
      ctx: ctx("see https://example.com/page"),
    });

    expect(result.outputs).toEqual(["summarized page"]);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      "https://example.com/page",
      expect.objectContaining({
        headers: {
          Accept: "text/*,application/json,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "User-Agent": "OpenClaw-LinkUnderstanding/1.0",
        },
        signal: expect.any(AbortSignal),
      }),
    );
    expect(runCommandWithTimeout).toHaveBeenCalledWith(["summarize", "--source"], {
      env: {
        OPENCLAW_LINK_FINAL_URL: "https://example.com/final",
        OPENCLAW_LINK_URL: "https://example.com/page",
      },
      input: "page body",
      timeoutMs: 30000,
    });
  });

  it("returns fetched content directly for configured curl-style fetchers", async () => {
    mockFetchResponse("fetched page body");

    const result = await runLinkUnderstanding({
      cfg: cfg({
        type: "cli",
        command: "curl",
        args: ["-s", "-L", "{{LinkUrl}}"],
      }),
      ctx: ctx("see http://192.168.1.64.nip.io:8888/aws-iam-credentials"),
    });

    expect(result.outputs).toEqual(["fetched page body"]);
    expect(globalThis.fetch).toHaveBeenCalledOnce();
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("skips links rejected by direct fetch", async () => {
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("fetch failed"));

    const result = await runLinkUnderstanding({
      cfg: cfg({ type: "cli", command: "summarize" }),
      ctx: ctx("see http://169.254.169.254.nip.io/latest/meta-data/"),
    });

    expect(result.outputs).toEqual([]);
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });

  it("skips links rejected by HTTP status", async () => {
    vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response("no", { status: 500 }));

    const result = await runLinkUnderstanding({
      cfg: cfg({ type: "cli", command: "summarize" }),
      ctx: ctx("see https://public.example/redirect-to-metadata"),
    });

    expect(result.outputs).toEqual([]);
    expect(runCommandWithTimeout).not.toHaveBeenCalled();
  });
});
