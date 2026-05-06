import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const rawOutputPath = process.env.OPENCLAW_IO_TRACE_OUT;
const outputPath =
  rawOutputPath && rawOutputPath.trim().length > 0
    ? path.resolve(
        rawOutputPath
          .replaceAll("{pid}", String(process.pid))
          .replaceAll("%p", String(process.pid)),
      )
    : path.resolve(process.cwd(), ".artifacts", "io-trace", `trace-${process.pid}.json`);
const roots = resolveTraceRoots();
const records = new Map();
const captureStacks = process.env.OPENCLAW_IO_TRACE_STACKS === "1";
let flushing = false;

function resolveTraceRoots() {
  const explicit = (process.env.OPENCLAW_IO_TRACE_ROOTS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => path.resolve(entry));
  if (explicit.length > 0) {
    return explicit;
  }
  return [
    process.cwd(),
    process.env.OPENCLAW_HOME,
    process.env.OPENCLAW_STATE_DIR,
    process.env.OPENCLAW_CONFIG_PATH ? path.dirname(process.env.OPENCLAW_CONFIG_PATH) : undefined,
  ]
    .filter((entry) => typeof entry === "string" && entry.length > 0)
    .map((entry) => path.resolve(entry));
}

function pathFromArg(value) {
  if (typeof value === "string") {
    return value;
  }
  if (value instanceof URL && value.protocol === "file:") {
    return fileURLToPath(value);
  }
  if (Buffer.isBuffer(value)) {
    return value.toString("utf8");
  }
  return undefined;
}

function normalizedTracePath(value) {
  const raw = pathFromArg(value);
  if (!raw || raw.length === 0) {
    return undefined;
  }
  const resolved = path.resolve(raw);
  if (!roots.some((root) => resolved === root || resolved.startsWith(`${root}${path.sep}`))) {
    return undefined;
  }
  return resolved;
}

function byteLength(value) {
  if (typeof value === "string") {
    return Buffer.byteLength(value);
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) {
    return value.byteLength;
  }
  return 0;
}

function stackSample() {
  if (!captureStacks) {
    return undefined;
  }
  return (new Error().stack ?? "")
    .split("\n")
    .slice(2)
    .map((line) => line.trim())
    .filter((line) => !line.includes("scripts/io-trace-preload.mjs"))
    .slice(0, 8)
    .join("\n");
}

function record(op, rawPath, bytes = 0) {
  const tracedPath = normalizedTracePath(rawPath);
  if (!tracedPath) {
    return;
  }
  const key = `${op}\0${tracedPath}`;
  const current = records.get(key) ?? {
    op,
    path: tracedPath,
    count: 0,
    bytes: 0,
    stacks: new Map(),
  };
  current.count += 1;
  current.bytes += bytes;
  const stack = stackSample();
  if (stack) {
    current.stacks.set(stack, (current.stacks.get(stack) ?? 0) + 1);
  }
  records.set(key, current);
}

function wrapSync(name, before) {
  const original = fs[name];
  if (typeof original !== "function") {
    return;
  }
  fs[name] = function tracedFsSync(...args) {
    before(args);
    const result = original.apply(this, args);
    if (name === "readFileSync") {
      record(name, args[0], byteLength(result));
    }
    return result;
  };
}

function wrapPromise(name, before, after) {
  const original = fs.promises[name];
  if (typeof original !== "function") {
    return;
  }
  fs.promises[name] = async function tracedFsPromise(...args) {
    before(args);
    const result = await original.apply(this, args);
    after?.(args, result);
    return result;
  };
}

wrapSync("readFileSync", (args) => record("readFileSync:start", args[0]));
wrapSync("writeFileSync", (args) => record("writeFileSync", args[0], byteLength(args[1])));
wrapSync("appendFileSync", (args) => record("appendFileSync", args[0], byteLength(args[1])));
wrapSync("readdirSync", (args) => record("readdirSync", args[0]));
wrapSync("statSync", (args) => record("statSync", args[0]));
wrapSync("lstatSync", (args) => record("lstatSync", args[0]));
wrapSync("existsSync", (args) => record("existsSync", args[0]));
wrapSync("mkdirSync", (args) => record("mkdirSync", args[0]));
wrapSync("rmSync", (args) => record("rmSync", args[0]));
wrapSync("unlinkSync", (args) => record("unlinkSync", args[0]));

wrapPromise(
  "readFile",
  (args) => record("readFile:start", args[0]),
  (args, result) => record("readFile", args[0], byteLength(result)),
);
wrapPromise("writeFile", (args) => record("writeFile", args[0], byteLength(args[1])));
wrapPromise("appendFile", (args) => record("appendFile", args[0], byteLength(args[1])));
wrapPromise("readdir", (args) => record("readdir", args[0]));
wrapPromise("stat", (args) => record("stat", args[0]));
wrapPromise("lstat", (args) => record("lstat", args[0]));
wrapPromise("access", (args) => record("access", args[0]));
wrapPromise("mkdir", (args) => record("mkdir", args[0]));
wrapPromise("rm", (args) => record("rm", args[0]));
wrapPromise("unlink", (args) => record("unlink", args[0]));

const originalCreateReadStream = fs.createReadStream;
fs.createReadStream = function tracedCreateReadStream(file, ...args) {
  record("createReadStream", file);
  return originalCreateReadStream.call(this, file, ...args);
};

const originalCreateWriteStream = fs.createWriteStream;
fs.createWriteStream = function tracedCreateWriteStream(file, ...args) {
  record("createWriteStream", file);
  return originalCreateWriteStream.call(this, file, ...args);
};

syncBuiltinESMExports();

function flush() {
  if (flushing) {
    return;
  }
  flushing = true;
  try {
    const entries = [...records.values()]
      .map((entry) => {
        const stacks = [...entry.stacks.entries()]
          .map(([stack, count]) => ({ count, stack }))
          .sort((left, right) => right.count - left.count)
          .slice(0, 5);
        return { op: entry.op, path: entry.path, count: entry.count, bytes: entry.bytes, stacks };
      })
      .sort((left, right) => {
        const countDiff = right.count - left.count;
        return countDiff === 0 ? left.path.localeCompare(right.path) : countDiff;
      });
    const summary = {
      generatedAt: new Date().toISOString(),
      pid: process.pid,
      cwd: process.cwd(),
      command: process.argv,
      roots,
      operations: entries,
      totals: entries.reduce(
        (acc, entry) => {
          acc.count += entry.count;
          acc.bytes += entry.bytes;
          acc.paths.add(entry.path);
          return acc;
        },
        { count: 0, bytes: 0, paths: new Set() },
      ),
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(
      outputPath,
      `${JSON.stringify({ ...summary, totals: { ...summary.totals, paths: summary.totals.paths.size } }, null, 2)}\n`,
    );
  } catch (error) {
    process.stderr.write(`[io-trace] failed to write ${outputPath}: ${String(error)}\n`);
  }
}

process.once("beforeExit", flush);
process.once("exit", flush);
