import { afterEach, describe, expect, it, vi } from "vitest";

const registerSubCliByName = vi.fn(async () => true);
const parseAsync = vi.fn(async () => undefined);
const buildProgram = vi.fn(() => ({ parseAsync }));

vi.mock("../infra/dotenv.js", () => ({ loadDotEnv: vi.fn() }));
vi.mock("../infra/env.js", () => ({ normalizeEnv: vi.fn() }));
vi.mock("../infra/path-env.js", () => ({ ensureClawdbotCliOnPath: vi.fn() }));
vi.mock("../infra/runtime-guard.js", () => ({ assertSupportedRuntime: vi.fn() }));
vi.mock("../infra/errors.js", () => ({ formatUncaughtError: vi.fn(() => "error") }));
vi.mock("../infra/unhandled-rejections.js", () => ({ installUnhandledRejectionHandler: vi.fn() }));
vi.mock("../logging.js", () => ({ enableConsoleCapture: vi.fn() }));
vi.mock("./program.js", () => ({ buildProgram }));
vi.mock("./program/register.subclis.js", () => ({ registerSubCliByName }));
vi.mock("./route.js", () => ({ tryRouteCli: vi.fn(async () => false) }));

const { runCli } = await import("./run-main.js");

describe("runCli", () => {
  afterEach(() => {
    registerSubCliByName.mockClear();
    parseAsync.mockClear();
    buildProgram.mockClear();
  });

  it("registers the primary subcommand before parsing", async () => {
    const argv = ["/usr/bin/node-22", "/opt/clawdbot/entry.js", "gateway", "--port", "18789"];

    await runCli(argv);

    expect(registerSubCliByName).toHaveBeenCalledTimes(1);
    expect(registerSubCliByName).toHaveBeenCalledWith(expect.any(Object), "gateway");
    expect(parseAsync).toHaveBeenCalledWith(argv);
  });
});
