import { afterEach, expect, test } from "vitest";

import { getFinishedSession, getSession, resetProcessRegistryForTests } from "./bash-process-registry.js";
import { createExecTool } from "./bash-tools.exec.js";
import { killProcessTree } from "./shell-utils.js";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  resetProcessRegistryForTests();
});

test("background exec is not killed when tool signal aborts", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 0 });
  const abortController = new AbortController();

  const result = await tool.execute(
    "toolcall",
    { command: "node -e \"setTimeout(() => {}, 5000)\"", background: true },
    abortController.signal,
  );

  expect(result.details.status).toBe("running");
  const sessionId = (result.details as { sessionId: string }).sessionId;

  abortController.abort();

  await new Promise((resolve) => setTimeout(resolve, 150));

  const running = getSession(sessionId);
  const finished = getFinishedSession(sessionId);

  try {
    expect(finished).toBeUndefined();
    expect(running?.exited).toBe(false);
  } finally {
    const pid = running?.pid;
    if (pid) killProcessTree(pid);
  }
});

test("background exec still times out after tool signal abort", async () => {
  const tool = createExecTool({ allowBackground: true, backgroundMs: 0 });
  const abortController = new AbortController();

  const result = await tool.execute(
    "toolcall",
    {
      command: "node -e \"setTimeout(() => {}, 5000)\"",
      background: true,
      timeout: 0.2,
    },
    abortController.signal,
  );

  expect(result.details.status).toBe("running");
  const sessionId = (result.details as { sessionId: string }).sessionId;

  abortController.abort();

  let finished = getFinishedSession(sessionId);
  const deadline = Date.now() + 2000;
  while (!finished && Date.now() < deadline) {
    await sleep(20);
    finished = getFinishedSession(sessionId);
  }

  const running = getSession(sessionId);

  try {
    expect(finished?.status).toBe("failed");
  } finally {
    const pid = running?.pid;
    if (pid) killProcessTree(pid);
  }
});
