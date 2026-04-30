import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export type NativeComputerUseNodesRuntime = {
  list: (params?: { connected?: boolean }) => Promise<{
    nodes: Array<{
      nodeId: string;
      displayName?: string;
      connected?: boolean;
      caps?: string[];
      commands?: string[];
      mcpServers?: Array<{ id?: string; status?: string }>;
    }>;
  }>;
  invoke: (params: {
    nodeId: string;
    command: string;
    params?: unknown;
    timeoutMs?: number;
    idempotencyKey?: string;
  }) => Promise<unknown>;
};

export type NativeComputerUseInstallResult = {
  ready: boolean;
  nodeId?: string;
  files?: number;
  bytes?: number;
  message: string;
};

export type NativeComputerUseInstallParams = {
  packagePath: string;
  pluginName: string;
  mcpServerName: string;
  signal?: AbortSignal;
};

export type NativeComputerUseInstaller = (
  params: NativeComputerUseInstallParams,
) => Promise<NativeComputerUseInstallResult>;

const COMPUTER_USE_MCP_SERVER_ID = "computer-use";
const INSTALL_COMMANDS = [
  "mcp.package.install.begin",
  "mcp.package.install.chunk",
  "mcp.package.install.finish",
  "mcp.package.install.cancel",
] as const;
const PACKAGE_CHUNK_BYTES = 256 * 1024;

type PackageFile = {
  absolutePath: string;
  relativePath: string;
  size: number;
  executable: boolean;
};

class NativeComputerUseInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NativeComputerUseInstallError";
  }
}

export function createNativeComputerUseInstaller(
  nodes: NativeComputerUseNodesRuntime,
): NativeComputerUseInstaller {
  return async (params) => installNativeComputerUsePackage(nodes, params);
}

export async function installNativeComputerUsePackage(
  nodes: NativeComputerUseNodesRuntime,
  params: NativeComputerUseInstallParams,
): Promise<NativeComputerUseInstallResult> {
  const node = await findNativeMcpPackageHost(nodes);
  if (hasReadyMcpServer(node, params.mcpServerName || COMPUTER_USE_MCP_SERVER_ID)) {
    return {
      ready: true,
      nodeId: node.nodeId,
      message: `OpenClaw.app already hosts Computer Use on ${node.displayName ?? node.nodeId}.`,
    };
  }
  const packagePath = path.resolve(params.packagePath);
  const files = await collectPackageFiles(packagePath);
  if (!files.some((file) => file.relativePath === ".mcp.json")) {
    throw new NativeComputerUseInstallError(
      `Computer Use package at ${packagePath} is missing .mcp.json.`,
    );
  }
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  const transferId = randomUUID();
  try {
    await invokePackageCommand(nodes, {
      nodeId: node.nodeId,
      command: "mcp.package.install.begin",
      params: {
        transferId,
        nodeId: node.nodeId,
        serverId: params.mcpServerName || COMPUTER_USE_MCP_SERVER_ID,
        packageName: params.pluginName,
        sourcePath: packagePath,
        fileCount: files.length,
        totalBytes,
      },
      signal: params.signal,
    });

    for (const file of files) {
      params.signal?.throwIfAborted();
      await sendFileChunks(nodes, {
        nodeId: node.nodeId,
        transferId,
        file,
        signal: params.signal,
      });
    }

    await invokePackageCommand(nodes, {
      nodeId: node.nodeId,
      command: "mcp.package.install.finish",
      params: { transferId },
      signal: params.signal,
    });
    return {
      ready: true,
      nodeId: node.nodeId,
      files: files.length,
      bytes: totalBytes,
      message: `Installed Computer Use package into OpenClaw.app on ${node.displayName ?? node.nodeId}.`,
    };
  } catch (error) {
    await invokePackageCommand(nodes, {
      nodeId: node.nodeId,
      command: "mcp.package.install.cancel",
      params: { transferId },
      signal: undefined,
    }).catch(() => undefined);
    throw error;
  }
}

function hasReadyMcpServer(
  node: { mcpServers?: Array<{ id?: string; status?: string }> },
  serverId: string,
): boolean {
  return (
    node.mcpServers?.some((server) => server.id === serverId && server.status === "ready") === true
  );
}

async function findNativeMcpPackageHost(nodes: NativeComputerUseNodesRuntime) {
  const listed = await nodes.list({ connected: true });
  const candidates = listed.nodes
    .filter((node) => node.connected !== false)
    .filter((node) => node.caps?.includes("mcpHost"))
    .filter((node) =>
      INSTALL_COMMANDS.every((command) => node.commands?.includes(command) === true),
    )
    .toSorted((left, right) => {
      const labelDelta = (left.displayName ?? "").localeCompare(right.displayName ?? "");
      return labelDelta !== 0 ? labelDelta : left.nodeId.localeCompare(right.nodeId);
    });
  const node = candidates[0];
  if (!node) {
    throw new NativeComputerUseInstallError(
      "No connected OpenClaw.app node can install native MCP packages. Open OpenClaw.app on this Mac and pair it with the Gateway, then retry /codex computer-use install.",
    );
  }
  return node;
}

async function collectPackageFiles(packagePath: string): Promise<PackageFile[]> {
  const rootStat = await fs.stat(packagePath);
  if (!rootStat.isDirectory()) {
    throw new NativeComputerUseInstallError(`${packagePath} is not a directory.`);
  }
  const files: PackageFile[] = [];
  await collectPackageFilesIn(packagePath, packagePath, files);
  return files.toSorted((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function collectPackageFilesIn(
  root: string,
  current: string,
  files: PackageFile[],
): Promise<void> {
  const entries = await fs.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(current, entry.name);
    const relativePath = toPackageRelativePath(root, absolutePath);
    if (entry.isDirectory()) {
      await collectPackageFilesIn(root, absolutePath, files);
      continue;
    }
    if (!entry.isFile()) {
      throw new NativeComputerUseInstallError(
        `Computer Use package contains unsupported entry ${relativePath}.`,
      );
    }
    if (relativePath === ".openclaw-computer-use-source.json") {
      continue;
    }
    const stat = await fs.stat(absolutePath);
    files.push({
      absolutePath,
      relativePath,
      size: stat.size,
      executable: (stat.mode & 0o111) !== 0,
    });
  }
}

function toPackageRelativePath(root: string, absolutePath: string): string {
  const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");
  if (
    !relativePath ||
    relativePath.startsWith("../") ||
    relativePath === ".." ||
    path.isAbsolute(relativePath)
  ) {
    throw new NativeComputerUseInstallError(`Unsafe package path ${relativePath}.`);
  }
  return relativePath;
}

async function sendFileChunks(
  nodes: NativeComputerUseNodesRuntime,
  params: {
    nodeId: string;
    transferId: string;
    file: PackageFile;
    signal?: AbortSignal;
  },
): Promise<void> {
  const handle = await fs.open(params.file.absolutePath, "r");
  try {
    const buffer = Buffer.allocUnsafe(PACKAGE_CHUNK_BYTES);
    let offset = 0;
    while (offset < params.file.size || (params.file.size === 0 && offset === 0)) {
      params.signal?.throwIfAborted();
      const { bytesRead } = await handle.read(
        buffer,
        0,
        Math.min(PACKAGE_CHUNK_BYTES, Math.max(1, params.file.size - offset)),
        offset,
      );
      const chunk = bytesRead > 0 ? buffer.subarray(0, bytesRead) : Buffer.alloc(0);
      await invokePackageCommand(nodes, {
        nodeId: params.nodeId,
        command: "mcp.package.install.chunk",
        params: {
          transferId: params.transferId,
          relativePath: params.file.relativePath,
          dataBase64: chunk.toString("base64"),
          executable: params.file.executable,
        },
        signal: params.signal,
      });
      if (params.file.size === 0 || bytesRead === 0) {
        break;
      }
      offset += bytesRead;
    }
  } finally {
    await handle.close();
  }
}

async function invokePackageCommand(
  nodes: NativeComputerUseNodesRuntime,
  params: {
    nodeId: string;
    command: (typeof INSTALL_COMMANDS)[number];
    params: unknown;
    signal?: AbortSignal;
  },
): Promise<Record<string, unknown>> {
  params.signal?.throwIfAborted();
  const response = await nodes.invoke({
    nodeId: params.nodeId,
    command: params.command,
    params: params.params,
    timeoutMs: 60_000,
    idempotencyKey: randomUUID(),
  });
  const payload = unwrapInvokePayload(response);
  if (payload.ok === false) {
    throw new NativeComputerUseInstallError(readErrorMessage(payload));
  }
  return payload;
}

function unwrapInvokePayload(response: unknown): Record<string, unknown> {
  if (!isRecord(response)) {
    return {};
  }
  if (response.ok === false) {
    throw new NativeComputerUseInstallError(readErrorMessage(response));
  }
  const payloadJSON = typeof response.payloadJSON === "string" ? response.payloadJSON : undefined;
  if (payloadJSON) {
    try {
      const parsed = JSON.parse(payloadJSON) as unknown;
      return isRecord(parsed) ? parsed : {};
    } catch {
      throw new NativeComputerUseInstallError("Native Computer Use install returned invalid JSON.");
    }
  }
  return isRecord(response.payload) ? response.payload : response;
}

function readErrorMessage(value: Record<string, unknown>): string {
  const error = isRecord(value.error) ? value.error : undefined;
  return (
    readString(error?.message) ??
    readString(value.message) ??
    readString(error?.code) ??
    "Native Computer Use install failed."
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
