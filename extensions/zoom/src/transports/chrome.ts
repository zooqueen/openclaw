import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { callGatewayFromCli } from "openclaw/plugin-sdk/gateway-runtime";
import type { PluginRuntime } from "openclaw/plugin-sdk/plugin-runtime";
import type { RuntimeLogger } from "openclaw/plugin-sdk/plugin-runtime";
import type { ZoomConfig, ZoomMode } from "../config.js";
import {
  startNativeConversationBridge,
  type ZoomNativeConversationHandle,
} from "../conversation.js";
import {
  startNodeRealtimeAudioBridge,
  type ChromeNodeRealtimeAudioBridgeHandle,
} from "../realtime-node.js";
import {
  startCommandRealtimeAudioBridge,
  type ChromeRealtimeAudioBridgeHandle,
} from "../realtime.js";
import {
  asBrowserTabs,
  callBrowserProxyOnNode,
  isSameZoomUrlForReuse,
  normalizeZoomUrlForReuse,
  readBrowserTab,
  resolveChromeNode,
  type BrowserTab,
} from "./chrome-browser-proxy.js";
import type { ZoomChromeHealth } from "./types.js";

export const ZOOM_SYSTEM_PROFILER_COMMAND = "/usr/sbin/system_profiler";

type BrowserRequestParams = {
  method: "GET" | "POST" | "DELETE";
  path: string;
  query?: Record<string, string | number | boolean | undefined>;
  body?: unknown;
  timeoutMs: number;
};

type BrowserRequestCaller = (params: BrowserRequestParams) => Promise<unknown>;

const chromeTransportDeps: {
  callGatewayFromCli: typeof callGatewayFromCli;
} = {
  callGatewayFromCli,
};

type LocalZoomAudioBridge =
  | { type: "external-command" }
  | ({ type: "command-pair" } & ChromeRealtimeAudioBridgeHandle)
  | ({ type: "native-conversation" } & ZoomNativeConversationHandle);

export const __testing = {
  setDepsForTest(deps: { callGatewayFromCli?: typeof callGatewayFromCli } | null) {
    chromeTransportDeps.callGatewayFromCli = deps?.callGatewayFromCli ?? callGatewayFromCli;
  },
};

export function outputMentionsBlackHole2ch(output: string): boolean {
  return /\bBlackHole\s+2ch\b/i.test(output);
}

export async function assertBlackHole2chAvailable(params: {
  runtime: PluginRuntime;
  timeoutMs: number;
}): Promise<void> {
  if (process.platform !== "darwin") {
    throw new Error("Chrome Zoom transport with blackhole-2ch audio is currently macOS-only");
  }

  const result = await params.runtime.system.runCommandWithTimeout(
    [ZOOM_SYSTEM_PROFILER_COMMAND, "SPAudioDataType"],
    { timeoutMs: params.timeoutMs },
  );
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  if (result.code !== 0 || !outputMentionsBlackHole2ch(output)) {
    const hint =
      params.runtime.system.formatNativeDependencyHint?.({
        packageName: "BlackHole 2ch",
        downloadCommand: "brew install blackhole-2ch",
      }) ?? "";
    throw new Error(
      [
        "BlackHole 2ch audio device not found.",
        "Install BlackHole 2ch and route Chrome input/output through the OpenClaw audio bridge.",
        hint,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }
}

export async function launchChromeZoom(params: {
  runtime: PluginRuntime;
  config: ZoomConfig;
  fullConfig: OpenClawConfig;
  meetingSessionId: string;
  mode: ZoomMode;
  url: string;
  logger: RuntimeLogger;
}): Promise<{
  launched: boolean;
  audioBridge?: LocalZoomAudioBridge;
  browser?: ZoomChromeHealth;
}> {
  const needsAudioBridge = params.mode === "realtime" || params.mode === "conversation";
  if (needsAudioBridge) {
    await assertBlackHole2chAvailable({
      runtime: params.runtime,
      timeoutMs: Math.min(params.config.chrome.joinTimeoutMs, 10_000),
    });

    if (params.config.chrome.audioBridgeHealthCommand) {
      const health = await params.runtime.system.runCommandWithTimeout(
        params.config.chrome.audioBridgeHealthCommand,
        { timeoutMs: params.config.chrome.joinTimeoutMs },
      );
      if (health.code !== 0) {
        throw new Error(
          `Chrome audio bridge health check failed: ${health.stderr || health.stdout || health.code}`,
        );
      }
    }
  }

  const startAudioBridge = async (): Promise<LocalZoomAudioBridge | undefined> => {
    if (!needsAudioBridge) {
      return undefined;
    }

    if (params.config.chrome.audioBridgeCommand) {
      const bridge = await params.runtime.system.runCommandWithTimeout(
        params.config.chrome.audioBridgeCommand,
        { timeoutMs: params.config.chrome.joinTimeoutMs },
      );
      if (bridge.code !== 0) {
        throw new Error(
          `failed to start Chrome audio bridge: ${bridge.stderr || bridge.stdout || bridge.code}`,
        );
      }
      return { type: "external-command" };
    }

    if (params.mode === "realtime") {
      if (!params.config.chrome.audioInputCommand || !params.config.chrome.audioOutputCommand) {
        throw new Error(
          "Chrome realtime mode requires chrome.audioInputCommand and chrome.audioOutputCommand, or chrome.audioBridgeCommand for an external bridge.",
        );
      }
      return {
        type: "command-pair",
        ...(await startCommandRealtimeAudioBridge({
          config: params.config,
          fullConfig: params.fullConfig,
          runtime: params.runtime,
          meetingSessionId: params.meetingSessionId,
          inputCommand: params.config.chrome.audioInputCommand,
          outputCommand: params.config.chrome.audioOutputCommand,
          logger: params.logger,
        })),
      };
    }

    if (!params.config.chrome.audioInputCommand) {
      throw new Error("Chrome conversation mode requires chrome.audioInputCommand.");
    }
    params.logger.debug?.("[zoom] starting native conversation bridge");
    const bridge = await startNativeConversationBridge({
      config: params.config,
      fullConfig: params.fullConfig,
      runtime: params.runtime,
      meetingSessionId: params.meetingSessionId,
      inputCommand: params.config.chrome.audioInputCommand,
      playbackCommand: params.config.conversation.playbackCommand,
      logger: params.logger,
    });
    params.logger.debug?.("[zoom] native conversation bridge started");
    return {
      type: "native-conversation",
      ...bridge,
    };
  };

  if (params.config.chrome.launch) {
    const result = await openZoomWithBrowserRequest({
      callBrowser: callLocalBrowserRequest,
      config: params.config,
      useMedia: needsAudioBridge,
      url: params.url,
    });
    if (!needsAudioBridge || result.browser?.inCall !== true) {
      return result;
    }
    try {
      return { ...result, audioBridge: await startAudioBridge() };
    } catch (error) {
      await leaveZoomWithBrowserRequest({
        callBrowser: callLocalBrowserRequest,
        config: params.config,
        url: params.url,
        closeTab: true,
      }).catch((leaveError) => {
        params.logger.debug?.(
          `[zoom] browser cleanup after audio bridge failure ignored: ${
            leaveError instanceof Error ? leaveError.message : String(leaveError)
          }`,
        );
      });
      throw error;
    }
  }

  return { launched: false, audioBridge: await startAudioBridge() };
}

function parseNodeStartResult(raw: unknown): {
  launched?: boolean;
  bridgeId?: string;
  audioBridge?: { type?: string };
  browser?: ZoomChromeHealth;
} {
  const value =
    raw && typeof raw === "object" && "payload" in raw
      ? (raw as { payload?: unknown }).payload
      : raw;
  if (!value || typeof value !== "object") {
    throw new Error("Zoom node returned an invalid start result.");
  }
  return value as {
    launched?: boolean;
    bridgeId?: string;
    audioBridge?: { type?: string };
    browser?: ZoomChromeHealth;
  };
}

function parseZoomBrowserStatus(result: unknown): ZoomChromeHealth | undefined {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const raw = record.result;
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  const parsed = JSON.parse(raw) as {
    inCall?: boolean;
    micMuted?: boolean;
    cameraOn?: boolean;
    audioSetupOk?: boolean;
    microphoneSelected?: string;
    speakerSelected?: string;
    manualActionRequired?: boolean;
    manualActionReason?: ZoomChromeHealth["manualActionReason"];
    manualActionMessage?: string;
    url?: string;
    title?: string;
    notes?: string[];
  };
  return {
    inCall: parsed.inCall,
    micMuted: parsed.micMuted,
    cameraOn: parsed.cameraOn,
    audioSetupOk: parsed.audioSetupOk,
    microphoneSelected: parsed.microphoneSelected,
    speakerSelected: parsed.speakerSelected,
    manualActionRequired: parsed.manualActionRequired,
    manualActionReason: parsed.manualActionReason,
    manualActionMessage: parsed.manualActionMessage,
    browserUrl: parsed.url,
    browserTitle: parsed.title,
    status: "browser-control",
    notes: Array.isArray(parsed.notes)
      ? parsed.notes.filter((note): note is string => typeof note === "string")
      : undefined,
  };
}

async function callLocalBrowserRequest(params: BrowserRequestParams) {
  return await chromeTransportDeps.callGatewayFromCli(
    "browser.request",
    {
      json: true,
      timeout: String(params.timeoutMs + 5_000),
    },
    {
      method: params.method,
      path: params.path,
      query: params.query,
      body: params.body,
      timeoutMs: params.timeoutMs,
    },
    { progress: false },
  );
}

function mergeBrowserNotes(
  browser: ZoomChromeHealth | undefined,
  notes: string[],
): ZoomChromeHealth | undefined {
  if (!browser || notes.length === 0) {
    return browser;
  }
  return {
    ...browser,
    notes: [...new Set([...(browser.notes ?? []), ...notes])],
  };
}

function readSnapshotText(result: unknown): string {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  return typeof record.snapshot === "string" ? record.snapshot : "";
}

function findSnapshotRef(snapshot: string, patterns: RegExp[]): string | undefined {
  for (const line of snapshot.split("\n")) {
    if (!patterns.some((pattern) => pattern.test(line))) {
      continue;
    }
    const match = /\[ref=([^\]]+)\]/.exec(line);
    if (match?.[1]) {
      return match[1];
    }
  }
  return undefined;
}

async function readZoomSnapshot(params: {
  callBrowser: BrowserRequestCaller;
  targetId: string;
  timeoutMs: number;
}): Promise<string> {
  return readSnapshotText(
    await params.callBrowser({
      method: "GET",
      path: "/snapshot",
      query: {
        format: "ai",
        targetId: params.targetId,
        limit: 500,
      },
      timeoutMs: Math.min(params.timeoutMs, 10_000),
    }),
  );
}

async function clickSnapshotRef(params: {
  callBrowser: BrowserRequestCaller;
  targetId: string;
  ref: string;
  timeoutMs: number;
}) {
  await params.callBrowser({
    method: "POST",
    path: "/act",
    body: {
      kind: "click",
      targetId: params.targetId,
      ref: params.ref,
      timeoutMs: Math.min(params.timeoutMs, 5_000),
    },
    timeoutMs: Math.min(params.timeoutMs, 8_000),
  });
}

async function driveZoomFrameControls(params: {
  callBrowser: BrowserRequestCaller;
  targetId: string;
  guestName: string;
  useMedia: boolean;
  timeoutMs: number;
}): Promise<string[]> {
  const notes: string[] = [];
  const clickBySnapshot = async (patterns: RegExp[], note: string) => {
    const snapshot = await readZoomSnapshot(params);
    const ref = findSnapshotRef(snapshot, patterns);
    if (!ref) {
      return false;
    }
    await clickSnapshotRef({ ...params, ref });
    notes.push(note);
    return true;
  };

  const clickMediaChoice = async () => {
    if (params.useMedia) {
      const clicked = await clickBySnapshot(
        [
          /button\s+"?Use microphone and camera"?/i,
          /button\s+"?Join with microphone and camera"?/i,
          /button\s+"?Continue with microphone and camera"?/i,
        ],
        "Allowed Zoom microphone/camera choice.",
      );
      if (clicked) {
        return;
      }
    }
    await clickBySnapshot(
      [
        /button\s+"?Continue without microphone and camera"?/i,
        /button\s+"?Continue without (microphone|mic|camera|audio|video)/i,
        /button\s+"?Join without (microphone|mic|camera|audio|video)/i,
      ],
      "Continued in Zoom without microphone/camera.",
    );
  };

  await clickMediaChoice();
  await clickBySnapshot([/button\s+"?Stop Video"?/i], "Turned Zoom camera off.");

  const nameSnapshot = await readZoomSnapshot(params);
  if (/Your Name|Enter Meeting Info/i.test(nameSnapshot)) {
    const nameRef = findSnapshotRef(nameSnapshot, [/textbox/i]);
    if (nameRef) {
      await params.callBrowser({
        method: "POST",
        path: "/act",
        body: {
          kind: "fill",
          targetId: params.targetId,
          fields: [{ ref: nameRef, type: "text", value: params.guestName }],
          timeoutMs: Math.min(params.timeoutMs, 5_000),
        },
        timeoutMs: Math.min(params.timeoutMs, 8_000),
      });
      notes.push("Filled Zoom display name.");
    }
  }

  await clickMediaChoice();
  await clickBySnapshot([/button\s+"?Join"?/i, /button\s+"?Join Meeting"?/i], "Clicked Zoom Join.");
  await clickBySnapshot(
    [/button\s+"?Join Audio by Computer"?/i, /button\s+"?Join with Computer Audio"?/i],
    "Joined Zoom computer audio.",
  );
  await clickBySnapshot([/button\s+"?Stop Video"?/i], "Turned Zoom camera off after joining.");
  return notes;
}

function resolveBrowserPermissionOrigin(value: string | undefined): string {
  if (!value) {
    return "https://zoom.us";
  }
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "zoom.us" || host.endsWith(".zoom.us"))
      ? url.origin
      : "https://zoom.us";
  } catch {
    return "https://zoom.us";
  }
}

function parsePermissionGrantNotes(result: unknown): string[] {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const unsupportedPermissions = Array.isArray(record.unsupportedPermissions)
    ? record.unsupportedPermissions.filter((value): value is string => typeof value === "string")
    : [];
  const notes = ["Granted Zoom microphone/camera permissions through browser control."];
  if (unsupportedPermissions.includes("speakerSelection")) {
    notes.push("Chrome did not accept the optional Zoom speaker-selection permission.");
  }
  return notes;
}

async function grantZoomMediaPermissions(params: {
  callBrowser: BrowserRequestCaller;
  origin: string;
  timeoutMs: number;
}): Promise<string[]> {
  try {
    const result = await params.callBrowser({
      method: "POST",
      path: "/permissions/grant",
      body: {
        origin: params.origin,
        permissions: ["audioCapture", "videoCapture"],
        optionalPermissions: ["speakerSelection"],
        timeoutMs: Math.min(params.timeoutMs, 5_000),
      },
      timeoutMs: Math.min(params.timeoutMs, 5_000),
    });
    return parsePermissionGrantNotes(result);
  } catch (error) {
    return [
      `Could not grant Zoom media permissions automatically: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ];
  }
}

function zoomStatusScript(params: { guestName: string; autoJoin: boolean; useMedia: boolean }) {
  return `async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    if (!node || node.disabled) return false;
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  };
  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
  const label = (node) => [
    node?.getAttribute?.("aria-label"),
    node?.getAttribute?.("title"),
    node?.getAttribute?.("data-tooltip"),
    node?.getAttribute?.("data-original-title"),
    node?.getAttribute?.("data-testid"),
    node?.getAttribute?.("placeholder"),
    node?.getAttribute?.("name"),
    node?.value,
    text(node),
  ].filter(Boolean).join(" ");
  const docs = () => {
    const result = [document];
    for (const frame of [...document.querySelectorAll('iframe')]) {
      try {
        if (frame.contentDocument) result.push(frame.contentDocument);
      } catch {}
    }
    return result;
  };
  const queryAll = (selector) => docs().flatMap((doc) => [...doc.querySelectorAll(selector)]);
  const clickables = () => queryAll('button, a, [role="button"], input[type="button"], input[type="submit"], [role="menuitem"], [role="option"], li, div[aria-label], span[aria-label]').filter(visible);
  const findClickable = (pattern) =>
    clickables().find((node) => pattern.test(label(node) || ""));
  const clickIfFound = async (pattern, note) => {
    const node = findClickable(pattern);
    if (!node) return false;
    node.click();
    if (note) notes.push(note);
    await sleep(250);
    return true;
  };
  const joinLooksDisabled = (node) =>
    !node || node.disabled || /\\bdisabled\\b/i.test(String(node.className || "")) || node.getAttribute?.("aria-disabled") === "true";
  const setInputValue = (input, value) => {
    input.focus();
    const valueSetter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value")?.set;
    const previousValue = input.value;
    if (valueSetter) valueSetter.call(input, value); else input.value = value;
    input._valueTracker?.setValue?.(previousValue);
    input.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, inputType: 'insertText', data: value }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', bubbles: true }));
  };
  const notes = [];
  const pageUrl = location.href;
  const autoJoin = ${JSON.stringify(params.autoJoin)};
  const useMedia = ${JSON.stringify(params.useMedia)};
  const desiredName = ${JSON.stringify(params.guestName)};
  const joinFromBrowser = findClickable(/join from (your )?browser/i);
  if (autoJoin && joinFromBrowser) {
    joinFromBrowser.click();
    notes.push("Clicked Zoom join-from-browser control.");
    await sleep(500);
  }

  const buttons = () => queryAll('button').filter(visible);
  const useMediaChoice = async () =>
    await clickIfFound(
      /use microphone and camera|join with microphone and camera|continue with microphone and camera/i,
      "Allowed Zoom microphone/camera choice.",
    );
  const continueWithoutMedia = async () =>
    await clickIfFound(
      /continue without (microphone|mic|camera|audio|video)|join without (microphone|mic|camera|audio|video)/i,
      "Continued in Zoom without microphone/camera.",
    );
  if (autoJoin) {
    if (useMedia) {
      await useMediaChoice();
    } else {
      await continueWithoutMedia();
    }
  }
  const stopVideoIfOn = async (context) => {
    const stopVideo = findClickable(/(^|\\b)stop video(\\b|$)|turn off video|camera on/i);
    if (!autoJoin || !stopVideo || joinLooksDisabled(stopVideo)) return false;
    stopVideo.click();
    notes.push(context);
    await sleep(350);
    return true;
  };
  await stopVideoIfOn("Turned Zoom camera off.");

  const audioLabels = () => clickables().map(label).filter(Boolean);
  const selectedBlackHoleLabels = () => audioLabels().filter((value) => /blackhole 2ch/i.test(value) && /selected|checked|current|active/i.test(value));
  const blackHoleMicSelected = () => selectedBlackHoleLabels().some((value) => /microphone|mic|input/i.test(value)) || audioLabels().some((value) => /microphone|mic|input/i.test(value) && /blackhole 2ch/i.test(value) && /selected|checked|current|active/i.test(value));
  const blackHoleSpeakerSelected = () => selectedBlackHoleLabels().some((value) => /speaker|output/i.test(value)) || audioLabels().some((value) => /speaker|output/i.test(value) && /blackhole 2ch/i.test(value) && /selected|checked|current|active/i.test(value));
  const ensureAudioMenuOpen = async () => {
    if (audioLabels().some((value) => /blackhole 2ch|select a microphone|select a speaker|microphone|speaker/i.test(value))) return true;
    return await clickIfFound(/more audio controls|audio controls|select audio|audio settings|microphone|mute|unmute|join audio/i, "Opened Zoom audio device menu.");
  };
  const selectBlackHoleDevices = async () => {
    if (!autoJoin) return;
    await ensureAudioMenuOpen();
    for (let i = 0; i < 3; i += 1) {
      const candidates = clickables().filter((node) => /blackhole 2ch/i.test(label(node)) && !/selected|checked|current|active/i.test(label(node)));
      if (candidates.length === 0) break;
      const node = candidates[0];
      node.click();
      notes.push("Selected BlackHole 2ch in Zoom audio devices.");
      await sleep(300);
      await ensureAudioMenuOpen();
    }
  };
  await selectBlackHoleDevices();

  const nameInput = queryAll('input').find((el) =>
    el.type !== 'hidden' &&
    /your name|display name|name/i.test(el.getAttribute('aria-label') || el.placeholder || el.name || '')
  ) ?? queryAll('input').find((el) => el.type !== 'hidden' && el.getBoundingClientRect().width > 100 && el.getBoundingClientRect().height > 10);
  if (autoJoin && nameInput && nameInput.value !== desiredName) {
    setInputValue(nameInput, desiredName);
    notes.push("Filled Zoom display name.");
    await sleep(300);
  }
  const passcodeInput = queryAll('input').find((el) =>
    /passcode|password/i.test(el.getAttribute('aria-label') || el.placeholder || el.name || '')
  );
  const audioChoice = findClickable(
    useMedia
      ? /use microphone and camera|join with microphone and camera|continue with microphone and camera|join audio by computer|join with computer audio/i
      : /continue without microphone and camera|join audio by computer|join with computer audio/i,
  );
  if (autoJoin && audioChoice) {
    audioChoice.click();
    notes.push("Accepted Zoom audio/video choice with browser automation.");
    await sleep(500);
  }
  if (autoJoin) {
    if (useMedia) {
      await useMediaChoice();
    } else {
      await continueWithoutMedia();
    }
  }
  const join = autoJoin ? findClickable(/^(join|join meeting|join webinar)$/i) : null;
  if (join && !joinLooksDisabled(join)) {
    join.click();
    notes.push("Clicked Zoom Join.");
    await sleep(500);
  }
  if (autoJoin) {
    await clickIfFound(/join audio by computer|join with computer audio|use computer audio/i, "Joined Zoom computer audio.");
  }
  await selectBlackHoleDevices();
  await stopVideoIfOn("Turned Zoom camera off after joining.");
  const currentButtons = buttons();
  const mic = currentButtons.find((button) => /mute|unmute|microphone/i.test(label(button)));
  const video = currentButtons.find((button) => /start video|stop video|camera|video/i.test(label(button)));
  const inCall = currentButtons.some((button) => /leave|end meeting|end webinar/i.test(label(button)));
  const pageText = docs().map((doc) => text(doc.body)).join("\\n").toLowerCase();
  const labels = audioLabels();
  const microphoneSelected = labels.find((value) => /microphone|mic|input/i.test(value) && /blackhole 2ch/i.test(value) && /selected|checked|current|active/i.test(value));
  const speakerSelected = labels.find((value) => /speaker|output/i.test(value) && /blackhole 2ch/i.test(value) && /selected|checked|current|active/i.test(value));
  const audioSetupOk = blackHoleMicSelected() && blackHoleSpeakerSelected();
  const permissionNeeded = /allow.*(microphone|camera)|blocked.*(microphone|camera)|permission.*(microphone|camera|speaker)|browser prevents access/i.test(pageText);
  const preJoinVisible = Boolean(nameInput) || Boolean(join) || /enter meeting info|your name|remember my name|by clicking.*join/i.test(pageText);
  let manualActionReason;
  let manualActionMessage;
  if (!inCall && joinFromBrowser && !autoJoin) {
    manualActionReason = "zoom-browser-join-required";
    manualActionMessage = "Click Join from Browser in the OpenClaw browser profile, then retry.";
  } else if (!inCall && passcodeInput && !passcodeInput.value) {
    manualActionReason = "zoom-passcode-required";
    manualActionMessage = "Enter the Zoom meeting passcode in the OpenClaw browser profile, then retry.";
  } else if (!inCall && nameInput && !nameInput.value) {
    manualActionReason = "zoom-name-required";
    manualActionMessage = "Enter the Zoom display name in the OpenClaw browser profile, then retry.";
  } else if (!inCall && audioChoice && !autoJoin) {
    manualActionReason = "zoom-audio-choice-required";
    manualActionMessage = "Choose whether Zoom should use microphone/camera in the OpenClaw browser profile, then retry.";
  } else if (!inCall && !autoJoin && !preJoinVisible && /waiting room|host will let you in|please wait.*host|waiting for the host|host has another meeting in progress/i.test(pageText)) {
    manualActionReason = "zoom-admission-required";
    manualActionMessage = "Admit the OpenClaw browser participant in Zoom or wait for the host to start the meeting, then retry speech.";
  } else if (!inCall && !autoJoin && /sign in to (join|zoom)|login to join|need to sign in|authentication required/i.test(pageText)) {
    manualActionReason = "zoom-login-required";
    manualActionMessage = "Sign in to Zoom in the OpenClaw browser profile, then retry the Zoom join.";
  } else if (!inCall && !autoJoin && /meeting has ended|webinar has ended/i.test(pageText)) {
    manualActionReason = "zoom-meeting-ended";
    manualActionMessage = "Zoom reports that this meeting has ended.";
  } else if (!inCall && !autoJoin && /invalid meeting id|meeting id is invalid|unable to join this meeting/i.test(pageText)) {
    manualActionReason = "zoom-invalid-meeting";
    manualActionMessage = "Zoom reports that the meeting link or meeting id is invalid.";
  } else if (!inCall && permissionNeeded) {
    manualActionReason = "zoom-permission-required";
    manualActionMessage = "Allow microphone/camera/speaker permissions for Zoom in the OpenClaw browser profile, then retry.";
  }
  return JSON.stringify({
    clickedJoin: Boolean(join && !joinLooksDisabled(join)),
    clickedJoinFromBrowser: Boolean(joinFromBrowser && autoJoin),
    inCall,
    micMuted: mic ? /unmute/i.test(label(mic)) : undefined,
    cameraOn: video ? /stop video|camera on/i.test(label(video)) : undefined,
    audioSetupOk,
    microphoneSelected,
    speakerSelected,
    manualActionRequired: Boolean(manualActionReason),
    manualActionReason,
    manualActionMessage,
    title: document.title,
    url: pageUrl,
    notes
  });
}`;
}

function zoomLeaveScript() {
  return `async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const visible = (node) => {
    if (!node || node.disabled) return false;
    const style = node.ownerDocument?.defaultView?.getComputedStyle?.(node);
    if (style && (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")) return false;
    const rect = node.getBoundingClientRect?.();
    return !rect || rect.width > 0 || rect.height > 0;
  };
  const text = (node) => (node?.innerText || node?.textContent || "").replace(/\\s+/g, " ").trim();
  const label = (node) => [
    node?.getAttribute?.("aria-label"),
    node?.getAttribute?.("title"),
    node?.getAttribute?.("data-tooltip"),
    node?.getAttribute?.("data-original-title"),
    text(node),
  ].filter(Boolean).join(" ");
  const docs = () => {
    const result = [document];
    for (const frame of [...document.querySelectorAll('iframe')]) {
      try {
        if (frame.contentDocument) result.push(frame.contentDocument);
      } catch {}
    }
    return result;
  };
  const queryAll = (selector) => docs().flatMap((doc) => [...doc.querySelectorAll(selector)]).filter(visible);
  const clickables = () => queryAll('button, a, [role="button"], input[type="button"], input[type="submit"], [role="menuitem"], [role="option"], li, div[aria-label], span[aria-label]');
  const findClickable = (pattern) => clickables().find((node) => pattern.test(label(node) || ""));
  const notes = [];
  const click = async (pattern, note) => {
    const node = findClickable(pattern);
    if (!node) return false;
    node.click();
    if (note) notes.push(note);
    await sleep(350);
    return true;
  };
  const wasInCall = Boolean(findClickable(/(^|\\b)(leave|end meeting|end webinar)(\\b|$)/i));
  if (wasInCall) {
    await click(/(^|\\b)(leave|leave meeting|leave webinar)(\\b|$)/i, "Clicked Zoom leave control.");
    await click(/leave meeting|leave webinar|leave$/i, "Confirmed Zoom leave.");
  }
  await sleep(500);
  const stillInCall = Boolean(findClickable(/(^|\\b)(leave|end meeting|end webinar)(\\b|$)/i));
  return JSON.stringify({
    left: !stillInCall,
    wasInCall,
    inCall: stillInCall,
    title: document.title,
    url: location.href,
    notes
  });
}`;
}

function parseBrowserJsonResult(result: unknown): unknown {
  const record = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
  const raw = record.result;
  if (typeof raw !== "string" || !raw.trim()) {
    return undefined;
  }
  return JSON.parse(raw) as unknown;
}

async function findZoomBrowserTab(params: {
  callBrowser: BrowserRequestCaller;
  config: ZoomConfig;
  url: string;
}): Promise<{ tab?: BrowserTab; targetId?: string }> {
  const timeoutMs = Math.max(1_000, params.config.chrome.joinTimeoutMs);
  const tabs = asBrowserTabs(
    await params.callBrowser({
      method: "GET",
      path: "/tabs",
      timeoutMs: Math.min(timeoutMs, 5_000),
    }),
  );
  const tab = tabs.find((entry) => isSameZoomUrlForReuse(entry.url, params.url));
  return { tab, targetId: tab?.targetId };
}

async function leaveZoomWithBrowserRequest(params: {
  callBrowser: BrowserRequestCaller;
  config: ZoomConfig;
  url: string;
  closeTab?: boolean;
}): Promise<ZoomChromeHealth> {
  if (!params.config.chrome.launch) {
    return {
      status: "browser-control",
      notes: ["Zoom browser leave skipped because chrome.launch is false."],
    };
  }
  const timeoutMs = Math.max(1_000, params.config.chrome.joinTimeoutMs);
  const { tab, targetId } = await findZoomBrowserTab(params);
  if (!targetId) {
    return {
      status: "browser-control",
      inCall: false,
      browserUrl: tab?.url,
      browserTitle: tab?.title,
      notes: ["No matching Zoom browser tab found during leave."],
    };
  }
  await params.callBrowser({
    method: "POST",
    path: "/tabs/focus",
    body: { targetId },
    timeoutMs: Math.min(timeoutMs, 5_000),
  });
  const evaluated = await params.callBrowser({
    method: "POST",
    path: "/act",
    body: {
      kind: "evaluate",
      targetId,
      fn: zoomLeaveScript(),
    },
    timeoutMs: Math.min(timeoutMs, 10_000),
  });
  const parsed =
    (parseBrowserJsonResult(evaluated) as
      | {
          inCall?: boolean;
          left?: boolean;
          title?: string;
          url?: string;
          notes?: string[];
        }
      | undefined) ?? {};
  const notes = Array.isArray(parsed.notes)
    ? parsed.notes.filter((note): note is string => typeof note === "string")
    : [];
  let closedTab = false;
  if (params.closeTab) {
    try {
      await params.callBrowser({
        method: "DELETE",
        path: `/tabs/${encodeURIComponent(targetId)}`,
        timeoutMs: Math.min(timeoutMs, 5_000),
      });
      closedTab = true;
      notes.push("Closed Zoom browser tab.");
    } catch (error) {
      notes.push(
        `Could not close Zoom browser tab: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
  return {
    status: "browser-control",
    inCall: closedTab ? false : parsed.inCall === true,
    browserUrl: parsed.url ?? tab?.url,
    browserTitle: parsed.title ?? tab?.title,
    notes,
  };
}

export async function leaveChromeZoom(params: {
  config: ZoomConfig;
  url: string;
}): Promise<ZoomChromeHealth> {
  return await leaveZoomWithBrowserRequest({
    callBrowser: callLocalBrowserRequest,
    config: params.config,
    url: params.url,
    closeTab: true,
  });
}

export async function leaveChromeZoomOnNode(params: {
  runtime: PluginRuntime;
  config: ZoomConfig;
  nodeId: string;
  url: string;
}): Promise<ZoomChromeHealth> {
  return await leaveZoomWithBrowserRequest({
    callBrowser: async (request) =>
      await callBrowserProxyOnNode({
        runtime: params.runtime,
        nodeId: params.nodeId,
        method: request.method,
        path: request.path,
        query: request.query,
        body: request.body,
        timeoutMs: request.timeoutMs,
      }),
    config: params.config,
    url: params.url,
    closeTab: true,
  });
}

async function openZoomWithBrowserProxy(params: {
  runtime: PluginRuntime;
  nodeId: string;
  config: ZoomConfig;
  useMedia: boolean;
  url: string;
}): Promise<{ launched: boolean; browser?: ZoomChromeHealth }> {
  return await openZoomWithBrowserRequest({
    callBrowser: async (request) =>
      await callBrowserProxyOnNode({
        runtime: params.runtime,
        nodeId: params.nodeId,
        method: request.method,
        path: request.path,
        query: request.query,
        body: request.body,
        timeoutMs: request.timeoutMs,
      }),
    config: params.config,
    useMedia: params.useMedia,
    url: params.url,
  });
}

async function openZoomWithBrowserRequest(params: {
  callBrowser: BrowserRequestCaller;
  config: ZoomConfig;
  useMedia: boolean;
  url: string;
}): Promise<{ launched: boolean; browser?: ZoomChromeHealth }> {
  if (!params.config.chrome.launch) {
    return { launched: false };
  }

  const timeoutMs = Math.max(1_000, params.config.chrome.joinTimeoutMs);
  let targetId: string | undefined;
  let tab: BrowserTab | undefined;
  if (params.config.chrome.reuseExistingTab) {
    const tabs = asBrowserTabs(
      await params.callBrowser({
        method: "GET",
        path: "/tabs",
        timeoutMs: Math.min(timeoutMs, 5_000),
      }),
    );
    tab = tabs.find((entry) => isSameZoomUrlForReuse(entry.url, params.url));
    targetId = tab?.targetId;
    if (targetId) {
      await params.callBrowser({
        method: "POST",
        path: "/tabs/focus",
        body: { targetId },
        timeoutMs: Math.min(timeoutMs, 5_000),
      });
    }
  }
  if (!targetId) {
    tab = readBrowserTab(
      await params.callBrowser({
        method: "POST",
        path: "/tabs/open",
        body: { url: params.url },
        timeoutMs,
      }),
    );
    targetId = tab?.targetId;
  }
  if (!targetId) {
    return {
      launched: true,
      browser: {
        status: "browser-control",
        notes: ["Browser proxy opened Zoom but did not return a targetId."],
        browserUrl: tab?.url,
        browserTitle: tab?.title,
      },
    };
  }

  const permissionNotes = await grantZoomMediaPermissions({
    callBrowser: params.callBrowser,
    origin: resolveBrowserPermissionOrigin(params.url),
    timeoutMs,
  });
  const deadline = Date.now() + Math.max(0, params.config.chrome.waitForInCallMs);
  let browser: ZoomChromeHealth | undefined = {
    status: "browser-control",
    browserUrl: tab?.url,
    browserTitle: tab?.title,
    notes: permissionNotes,
  };
  do {
    let frameNotes: string[] = [];
    try {
      if (params.config.chrome.autoJoin) {
        try {
          frameNotes = await driveZoomFrameControls({
            callBrowser: params.callBrowser,
            targetId,
            guestName: params.config.name,
            useMedia: params.useMedia,
            timeoutMs,
          });
        } catch (error) {
          frameNotes = [
            `Frame-aware Zoom controls were unavailable: ${
              error instanceof Error ? error.message : String(error)
            }`,
          ];
        }
      }
      const evaluated = await params.callBrowser({
        method: "POST",
        path: "/act",
        body: {
          kind: "evaluate",
          targetId,
          fn: zoomStatusScript({
            guestName: params.config.name,
            autoJoin: params.config.chrome.autoJoin,
            useMedia: params.useMedia,
          }),
        },
        timeoutMs: Math.min(timeoutMs, 10_000),
      });
      browser = mergeBrowserNotes(parseZoomBrowserStatus(evaluated) ?? browser, [
        ...permissionNotes,
        ...frameNotes,
      ]);
      if (browser?.inCall === true) {
        return { launched: true, browser };
      }
      if (browser?.manualActionRequired === true) {
        const retryableManualAction =
          params.config.chrome.autoJoin &&
          [
            "zoom-browser-join-required",
            "zoom-name-required",
            "zoom-audio-choice-required",
            "zoom-permission-required",
            "zoom-admission-required",
          ].includes(browser.manualActionReason ?? "");
        if (!retryableManualAction || Date.now() >= deadline) {
          return { launched: true, browser };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const transientNavigation = /execution context was destroyed|navigation|target closed/i.test(
        message,
      );
      browser = {
        ...browser,
        inCall: false,
        manualActionRequired: !transientNavigation,
        manualActionReason: transientNavigation ? undefined : "browser-control-unavailable",
        manualActionMessage: transientNavigation
          ? undefined
          : "Open the OpenClaw browser profile, finish Zoom login, admission, or permission prompts, then retry.",
        notes: [
          ...permissionNotes,
          ...frameNotes,
          `Browser control could not inspect or auto-join Zoom: ${message}`,
        ],
      };
      if (!transientNavigation) {
        break;
      }
    }
    if (Date.now() <= deadline) {
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
  } while (Date.now() <= deadline);
  if (browser && browser.inCall !== true && browser.manualActionRequired !== true) {
    browser = {
      ...browser,
      manualActionRequired: true,
      manualActionReason: "zoom-admission-required",
      manualActionMessage:
        "Zoom did not reach the in-call state before the join timeout. Finish the visible Zoom prompt or admit the OpenClaw browser participant, then retry.",
    };
  }
  return { launched: true, browser };
}

function isRecoverableZoomTab(tab: BrowserTab, url?: string): boolean {
  if (url) {
    return isSameZoomUrlForReuse(tab.url, url);
  }
  if (normalizeZoomUrlForReuse(tab.url)) {
    return true;
  }
  const tabUrl = tab.url ?? "";
  return /^https:\/\/[^/]*zoom\.us\//i.test(tabUrl) || /zoom/i.test(tab.title ?? "");
}

async function inspectRecoverableZoomTab(params: {
  callBrowser: BrowserRequestCaller;
  config: ZoomConfig;
  timeoutMs: number;
  tab: BrowserTab;
  targetId: string;
}) {
  await params.callBrowser({
    method: "POST",
    path: "/tabs/focus",
    body: { targetId: params.targetId },
    timeoutMs: Math.min(params.timeoutMs, 5_000),
  });
  const permissionNotes = await grantZoomMediaPermissions({
    callBrowser: params.callBrowser,
    origin: resolveBrowserPermissionOrigin(params.tab.url),
    timeoutMs: params.timeoutMs,
  });
  const evaluated = await params.callBrowser({
    method: "POST",
    path: "/act",
    body: {
      kind: "evaluate",
      targetId: params.targetId,
      fn: zoomStatusScript({
        guestName: params.config.name,
        autoJoin: false,
        useMedia: false,
      }),
    },
    timeoutMs: Math.min(params.timeoutMs, 10_000),
  });
  const browser = mergeBrowserNotes(
    parseZoomBrowserStatus(evaluated) ?? {
      status: "browser-control",
      browserUrl: params.tab.url,
      browserTitle: params.tab.title,
    },
    permissionNotes,
  );
  const manual = browser?.manualActionRequired
    ? browser.manualActionMessage || browser.manualActionReason
    : undefined;
  return {
    found: true,
    targetId: params.targetId,
    tab: params.tab,
    browser,
    message:
      manual ?? (browser?.inCall ? "Existing Zoom tab is in-call." : "Existing Zoom tab focused."),
  };
}

export async function recoverCurrentZoomTab(params: { config: ZoomConfig; url?: string }): Promise<{
  transport: "chrome";
  nodeId?: undefined;
  found: boolean;
  targetId?: string;
  tab?: BrowserTab;
  browser?: ZoomChromeHealth;
  message: string;
}> {
  const timeoutMs = Math.max(1_000, params.config.chrome.joinTimeoutMs);
  const tabs = asBrowserTabs(
    await callLocalBrowserRequest({
      method: "GET",
      path: "/tabs",
      timeoutMs: Math.min(timeoutMs, 5_000),
    }),
  );
  const tab = tabs.find((entry) => isRecoverableZoomTab(entry, params.url));
  const targetId = tab?.targetId;
  if (!tab || !targetId) {
    return {
      transport: "chrome",
      found: false,
      tab,
      message: params.url
        ? `No existing Zoom tab matched ${params.url}.`
        : "No existing Zoom tab found in local Chrome.",
    };
  }
  return {
    transport: "chrome",
    ...(await inspectRecoverableZoomTab({
      callBrowser: callLocalBrowserRequest,
      config: params.config,
      timeoutMs,
      tab,
      targetId,
    })),
  };
}

export async function recoverCurrentZoomTabOnNode(params: {
  runtime: PluginRuntime;
  config: ZoomConfig;
  url?: string;
}): Promise<{
  transport: "chrome-node";
  nodeId: string;
  found: boolean;
  targetId?: string;
  tab?: BrowserTab;
  browser?: ZoomChromeHealth;
  message: string;
}> {
  const nodeId = await resolveChromeNode({
    runtime: params.runtime,
    requestedNode: params.config.chromeNode.node,
  });
  const timeoutMs = Math.max(1_000, params.config.chrome.joinTimeoutMs);
  const tabs = asBrowserTabs(
    await callBrowserProxyOnNode({
      runtime: params.runtime,
      nodeId,
      method: "GET",
      path: "/tabs",
      timeoutMs: Math.min(timeoutMs, 5_000),
    }),
  );
  const tab = tabs.find((entry) => isRecoverableZoomTab(entry, params.url));
  const targetId = tab?.targetId;
  if (!tab || !targetId) {
    return {
      transport: "chrome-node",
      nodeId,
      found: false,
      tab,
      message: params.url
        ? `No existing Zoom tab matched ${params.url}.`
        : "No existing Zoom tab found on the selected Chrome node.",
    };
  }
  return {
    transport: "chrome-node",
    nodeId,
    ...(await inspectRecoverableZoomTab({
      callBrowser: async (request) =>
        await callBrowserProxyOnNode({
          runtime: params.runtime,
          nodeId,
          method: request.method,
          path: request.path,
          query: request.query,
          body: request.body,
          timeoutMs: request.timeoutMs,
        }),
      config: params.config,
      timeoutMs,
      tab,
      targetId,
    })),
  };
}

export type ZoomCurrentTabRecoveryResult = Awaited<
  ReturnType<typeof recoverCurrentZoomTab | typeof recoverCurrentZoomTabOnNode>
>;

export async function launchChromeZoomOnNode(params: {
  runtime: PluginRuntime;
  config: ZoomConfig;
  fullConfig: OpenClawConfig;
  meetingSessionId: string;
  mode: ZoomMode;
  url: string;
  logger: RuntimeLogger;
}): Promise<{
  nodeId: string;
  launched: boolean;
  audioBridge?:
    | { type: "external-command" }
    | ({ type: "node-command-pair" } & ChromeNodeRealtimeAudioBridgeHandle);
  browser?: ZoomChromeHealth;
}> {
  const nodeId = await resolveChromeNode({
    runtime: params.runtime,
    requestedNode: params.config.chromeNode.node,
  });
  try {
    await params.runtime.nodes.invoke({
      nodeId,
      command: "zoom.chrome",
      params: {
        action: "stopByUrl",
        url: params.url,
        mode: params.mode,
      },
      timeoutMs: 5_000,
    });
  } catch (error) {
    params.logger.debug?.(
      `[zoom] node bridge cleanup before join ignored: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const browserControl = await openZoomWithBrowserProxy({
    runtime: params.runtime,
    nodeId,
    config: params.config,
    useMedia: params.mode === "realtime",
    url: params.url,
  });
  if (params.mode === "conversation") {
    throw new Error(
      "Zoom conversation mode is currently supported only with the local chrome transport.",
    );
  }
  if (params.mode !== "realtime") {
    return {
      nodeId,
      launched: browserControl.launched,
      browser: browserControl.browser,
    };
  }
  if (browserControl.browser?.inCall !== true) {
    return {
      nodeId,
      launched: browserControl.launched,
      browser: browserControl.browser,
    };
  }

  const raw = await params.runtime.nodes.invoke({
    nodeId,
    command: "zoom.chrome",
    params: {
      action: "start",
      url: params.url,
      mode: params.mode,
      launch: false,
      browserProfile: params.config.chrome.browserProfile,
      joinTimeoutMs: params.config.chrome.joinTimeoutMs,
      audioInputCommand: params.config.chrome.audioInputCommand,
      audioOutputCommand: params.config.chrome.audioOutputCommand,
      audioBridgeCommand: params.config.chrome.audioBridgeCommand,
      audioBridgeHealthCommand: params.config.chrome.audioBridgeHealthCommand,
    },
    timeoutMs: params.config.chrome.joinTimeoutMs + 5_000,
  });
  const result = parseNodeStartResult(raw);
  if (result.audioBridge?.type === "node-command-pair") {
    if (!result.bridgeId) {
      throw new Error("Zoom node did not return an audio bridge id.");
    }
    const bridge = await startNodeRealtimeAudioBridge({
      config: params.config,
      fullConfig: params.fullConfig,
      runtime: params.runtime,
      meetingSessionId: params.meetingSessionId,
      nodeId,
      bridgeId: result.bridgeId,
      logger: params.logger,
    });
    return {
      nodeId,
      launched: browserControl.launched || result.launched === true,
      audioBridge: bridge,
      browser: browserControl.browser ?? result.browser,
    };
  }
  if (result.audioBridge?.type === "external-command") {
    return {
      nodeId,
      launched: browserControl.launched || result.launched === true,
      audioBridge: { type: "external-command" },
      browser: browserControl.browser ?? result.browser,
    };
  }
  return {
    nodeId,
    launched: browserControl.launched || result.launched === true,
    browser: browserControl.browser ?? result.browser,
  };
}
