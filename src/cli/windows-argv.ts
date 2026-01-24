import path from "node:path";
import process from "node:process";

type WindowsArgvOptions = {
  platform?: NodeJS.Platform;
  execPath?: string;
};

export function normalizeWindowsArgv(
  argv: string[],
  { platform = process.platform, execPath = process.execPath }: WindowsArgvOptions = {},
): string[] {
  if (platform !== "win32") return argv;
  if (argv.length < 2) return argv;

  const stripControlChars = (value: string): string => {
    let out = "";
    for (let i = 0; i < value.length; i += 1) {
      const code = value.charCodeAt(i);
      if (code >= 32 && code !== 127) {
        out += value[i];
      }
    }
    return out;
  };
  const normalizeArg = (value: string): string =>
    stripControlChars(value)
      .replace(/^['"]+|['"]+$/g, "")
      .trim();
  const normalizeCandidate = (value: string): string =>
    normalizeArg(value).replace(/^\\\\\\?\\/, "");
  const execPathNormalized = normalizeCandidate(execPath);
  const execPathLower = execPathNormalized.toLowerCase();
  const execBaseLower = path.basename(execPathLower);
  const isNodeExecPath = (value: string | undefined): boolean => {
    if (!value) return false;
    const normalized = normalizeCandidate(value);
    if (!normalized) return false;
    if (normalized.includes("://")) return false;
    const lower = normalized.toLowerCase();
    if (lower === execPathLower || lower === execBaseLower) return true;
    if (!lower.endsWith("node.exe")) return false;
    return path.isAbsolute(normalized) || normalized.includes("\\") || normalized.includes("/");
  };

  const next = [...argv];
  for (let i = 1; i <= 2 && i < next.length; ) {
    if (isNodeExecPath(next[i])) {
      next.splice(i, 1);
      continue;
    }
    i += 1;
  }
  return next;
}
