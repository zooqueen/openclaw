import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

import { danger, shouldLogVerbose } from "../globals.js";
import { logDebug, logError } from "../logger.js";

const execFileAsync = promisify(execFile);

// Simple promise-wrapped execFile with optional verbosity logging.
export async function runExec(
  command: string,
  args: string[],
  opts: number | { timeoutMs?: number; maxBuffer?: number } = 10_000,
): Promise<{ stdout: string; stderr: string }> {
  const options =
    typeof opts === "number"
      ? { timeout: opts, encoding: "utf8" as const }
      : {
          timeout: opts.timeoutMs,
          maxBuffer: opts.maxBuffer,
          encoding: "utf8" as const,
        };
  try {
    const { stdout, stderr } = await execFileAsync(command, args, options);
    if (shouldLogVerbose()) {
      if (stdout.trim()) logDebug(stdout.trim());
      if (stderr.trim()) logError(stderr.trim());
    }
    return { stdout, stderr };
  } catch (err) {
    if (shouldLogVerbose()) {
      logError(danger(`Command failed: ${command} ${args.join(" ")}`));
    }
    throw err;
  }
}

export type SpawnResult = {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  killed: boolean;
  timedOut: boolean;
};

export type CommandOptions = {
  timeoutMs: number;
  cwd?: string;
  input?: string;
  env?: NodeJS.ProcessEnv;
};

export async function runCommandWithTimeout(
  argv: string[],
  optionsOrTimeout: number | CommandOptions,
): Promise<SpawnResult> {
  const options: CommandOptions =
    typeof optionsOrTimeout === "number"
      ? { timeoutMs: optionsOrTimeout }
      : optionsOrTimeout;
  const { timeoutMs, cwd, input, env } = options;

  const supportsGroupKill = process.platform !== "win32";
  const killGraceMs = 5_000;

  // Spawn with inherited stdin (TTY) so tools like `pi` stay interactive when needed.
  return await new Promise((resolve, reject) => {
    const child = spawn(argv[0], argv.slice(1), {
      stdio: [input ? "pipe" : "inherit", "pipe", "pipe"],
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      detached: supportsGroupKill,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = setTimeout(() => {
      if (settled) return;
      timedOut = true;
      const pid = child.pid;
      if (pid) {
        try {
          if (supportsGroupKill) process.kill(-pid, "SIGTERM");
          else child.kill("SIGTERM");
        } catch {
          // ignore
        }
        killTimer = setTimeout(() => {
          try {
            if (supportsGroupKill) process.kill(-pid, "SIGKILL");
            else child.kill("SIGKILL");
          } catch {
            // ignore
          }
        }, killGraceMs);
      }
    }, timeoutMs);

    if (input && child.stdin) {
      child.stdin.write(input);
      child.stdin.end();
    }

    child.stdout?.on("data", (d) => {
      stdout += d.toString();
    });
    child.stderr?.on("data", (d) => {
      stderr += d.toString();
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      resolve({
        stdout,
        stderr,
        code,
        signal,
        killed: child.killed,
        timedOut,
      });
    });
  });
}
