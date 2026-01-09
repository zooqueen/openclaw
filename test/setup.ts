import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const shouldSanitizeConsoleOutput =
  process.platform === "win32" && process.env.GITHUB_ACTIONS === "true";

if (shouldSanitizeConsoleOutput) {
  const sanitize = (value: string) => {
    let out = "";
    for (const ch of value) {
      const code = ch.charCodeAt(0);
      if (code === 9 || code === 10 || code === 13) {
        out += ch;
        continue;
      }
      if (code >= 32 && code <= 126) {
        out += ch;
        continue;
      }
      out += "?";
    }
    return out;
  };

  const patchStream = (stream: NodeJS.WriteStream) => {
    const originalWrite = stream.write.bind(stream);
    stream.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      if (typeof chunk === "string") {
        return originalWrite(sanitize(chunk), encoding as never, cb as never);
      }
      if (Buffer.isBuffer(chunk)) {
        return originalWrite(
          sanitize(chunk.toString("utf8")),
          encoding as never,
          cb as never,
        );
      }
      return originalWrite(chunk as never, encoding as never, cb as never);
    }) as typeof stream.write;
  };

  patchStream(process.stdout);
  patchStream(process.stderr);
}

const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;
const originalXdgConfigHome = process.env.XDG_CONFIG_HOME;
const originalXdgDataHome = process.env.XDG_DATA_HOME;
const originalXdgStateHome = process.env.XDG_STATE_HOME;
const originalXdgCacheHome = process.env.XDG_CACHE_HOME;
const originalTestHome = process.env.CLAWDBOT_TEST_HOME;

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "clawdbot-test-home-"));
process.env.HOME = tempHome;
process.env.USERPROFILE = tempHome;
process.env.CLAWDBOT_TEST_HOME = tempHome;
process.env.XDG_CONFIG_HOME = path.join(tempHome, ".config");
process.env.XDG_DATA_HOME = path.join(tempHome, ".local", "share");
process.env.XDG_STATE_HOME = path.join(tempHome, ".local", "state");
process.env.XDG_CACHE_HOME = path.join(tempHome, ".cache");

const restoreEnv = (key: string, value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

process.on("exit", () => {
  restoreEnv("HOME", originalHome);
  restoreEnv("USERPROFILE", originalUserProfile);
  restoreEnv("XDG_CONFIG_HOME", originalXdgConfigHome);
  restoreEnv("XDG_DATA_HOME", originalXdgDataHome);
  restoreEnv("XDG_STATE_HOME", originalXdgStateHome);
  restoreEnv("XDG_CACHE_HOME", originalXdgCacheHome);
  restoreEnv("CLAWDBOT_TEST_HOME", originalTestHome);
  try {
    fs.rmSync(tempHome, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }
});
