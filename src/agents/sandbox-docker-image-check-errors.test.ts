import { describe, expect, it } from "vitest";

import { resolveDockerImageInspectResult } from "./sandbox/docker.js";

describe("ensureDockerImage", () => {
  it("surfaces inspect failures with detail", async () => {
    const result = resolveDockerImageInspectResult("custom-sandbox:latest", {
      stdout: "",
      stderr: "permission denied while trying to connect to the Docker daemon socket",
      code: 1,
    });

    expect(result).toEqual({
      exists: false,
      error:
        "Failed to inspect sandbox image: permission denied while trying to connect to the Docker daemon socket",
    });
  });
});
