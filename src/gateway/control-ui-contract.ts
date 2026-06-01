export const CONTROL_UI_BOOTSTRAP_CONFIG_PATH = "/__openclaw/control-ui-config.json";

/** Iframe sandbox policy advertised to the Control UI bootstrap payload. */
export type ControlUiEmbedSandboxMode = "strict" | "scripts" | "trusted";

/** Runtime config consumed by the browser Control UI before it opens RPC channels. */
export type ControlUiBootstrapConfig = {
  basePath: string;
  assistantName: string;
  assistantAvatar: string;
  assistantAvatarSource?: string | null;
  assistantAvatarStatus?: "none" | "local" | "remote" | "data" | null;
  assistantAvatarReason?: string | null;
  assistantAgentId: string;
  serverVersion?: string;
  localMediaPreviewRoots?: string[];
  embedSandbox?: ControlUiEmbedSandboxMode;
  allowExternalEmbedUrls?: boolean;
  chatMessageMaxWidth?: string;
};
