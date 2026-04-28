---
summary: "Zoom plugin: join explicit Zoom URLs through Chrome with realtime voice defaults"
read_when:
  - You want an OpenClaw agent to join a Zoom meeting
  - You are configuring Chrome or Chrome node as a Zoom transport
  - You are debugging Zoom browser join, passcode, waiting-room, or audio routing issues
title: "Zoom plugin"
---

Zoom participant support for OpenClaw is explicit by design:

- It only joins an explicit `https://*.zoom.us/...` meeting URL.
- `realtime` voice is the default mode.
- Realtime voice can call back into the full OpenClaw agent when deeper reasoning or tools are needed.
- Agents choose the join behavior with `mode`: use `realtime` for a duplex realtime voice provider, `conversation` for native STT/TTS with Zoom-owned VAD, or `transcribe` to join/control the browser without talk-back.
- Chrome can run locally or on a paired node host.
- There is no Twilio, dial-in, Zoom OAuth, meeting creation, or artifact export support in the initial plugin.
- There is no automatic consent announcement.
- The default Chrome audio backend is `BlackHole 2ch`.

## Quick start

Install the local audio dependencies and configure a backend realtime voice provider. OpenAI is the default; Google Gemini Live also works with `realtime.provider: "google"`:

```bash
brew install blackhole-2ch sox
export OPENAI_API_KEY=sk-...
# or
export GEMINI_API_KEY=...
```

`blackhole-2ch` installs the `BlackHole 2ch` virtual audio device. Homebrew's installer requires a reboot before macOS exposes the device:

```bash
sudo reboot
```

After reboot, verify both pieces:

```bash
system_profiler SPAudioDataType | grep -i BlackHole
command -v sox
```

Enable the plugin:

```json5
{
  plugins: {
    entries: {
      zoom: {
        enabled: true,
        config: {},
      },
    },
  },
}
```

Check setup:

```bash
openclaw zoom setup
```

Join a meeting:

```bash
openclaw zoom join 'https://example.zoom.us/j/123456789?pwd=...'
```

Or let an agent join through the `zoom_meeting` tool:

```json
{
  "action": "join",
  "url": "https://example.zoom.us/j/123456789?pwd=...",
  "transport": "chrome-node",
  "mode": "realtime"
}
```

For an observe-only/browser-control join, set `"mode": "transcribe"`. That does not start a talk-back bridge. For native always-listening local speech, set `"mode": "conversation"`; Zoom records utterances with VAD, transcribes them through `tools.media.audio`, asks the configured OpenClaw agent for a short reply, synthesizes speech through `messages.tts`, and plays the result back into the Zoom microphone route.

### Native local STT and TTS

OpenClaw already has native local speech hooks that pair well with Zoom browser audio. Use the shared media STT and TTS provider surfaces instead of making Zoom own a Whisper or TTS implementation.

For local STT with whisper.cpp, install/build `whisper-cli`, download a model, and configure audio media transcription:

```json5
{
  tools: {
    media: {
      audio: {
        enabled: true,
        models: [
          {
            type: "cli",
            command: "/opt/whisper.cpp/build/bin/whisper-cli",
            args: [
              "-m",
              "/opt/whisper.cpp/models/ggml-base.en.bin",
              "-otxt",
              "-of",
              "{{OutputBase}}",
              "-np",
              "-nt",
              "{{MediaPath}}",
            ],
            timeoutSeconds: 30,
          },
        ],
      },
    },
  },
}
```

If `whisper-cli` is on `PATH`, OpenClaw can also auto-detect it when `tools.media.audio.models` is unset. Set `WHISPER_CPP_MODEL` to the GGML model path to avoid the bundled tiny-model fallback.

For local TTS, use the native Local CLI speech provider. This example uses macOS `say`:

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "tts-local-cli",
      providers: {
        "tts-local-cli": {
          command: "say",
          args: ["-o", "{{OutputPath}}", "{{Text}}"],
          outputFormat: "wav",
          timeoutMs: 120000,
        },
      },
    },
  },
}
```

A local model wrapper such as VibeVoice can use the same native contract as long as it writes the requested output file:

```json5
{
  messages: {
    tts: {
      auto: "always",
      provider: "tts-local-cli",
      providers: {
        "tts-local-cli": {
          command: "/opt/vibevoice/.venv/bin/python",
          args: ["/opt/vibevoice/vibevoice-tts-file.py", "--output", "{{OutputPath}}", "{{Text}}"],
          outputFormat: "wav",
          timeoutMs: 120000,
        },
      },
    },
  },
}
```

With the native configuration above, join in always-listening conversation mode:

```bash
openclaw zoom join 'https://example.zoom.us/j/123456789?pwd=...' --mode conversation
```

Clean ownership for local freeflow is:

- Zoom owns only meeting transport: Chrome join/control, BlackHole device selection, recording, VAD/end-of-utterance detection, speaker playback, interruption, and echo suppression.
- STT stays on the native media-understanding surface. Zoom records one utterance to a temporary audio file and asks the configured `tools.media.audio` pipeline to transcribe it, so `whisper-cli`, `sherpa-onnx-offline`, or any provider fallback works without Zoom-specific code.
- TTS stays on the native speech surface. Zoom asks the configured `messages.tts` speech provider to synthesize speech, then routes the resulting file audio into BlackHole for the Zoom microphone.
- Provider plugins own model-specific setup and auth. A future VibeVoice provider should be a speech plugin or a `tts-local-cli` wrapper, not a Zoom dependency.

During realtime sessions, `zoom_meeting` status includes browser and audio bridge health such as `inCall`, `manualActionRequired`, `providerConnected`, `realtimeReady`, `audioInputActive`, `audioOutputActive`, last input/output timestamps, byte counters, and bridge closed state. If Zoom asks for a passcode, waiting-room admission, login, browser permission, or a manual browser-join step, the join/test-speech result reports `manualActionRequired: true` with a reason and message for the agent to relay.

## Local gateway + paired Chrome node

You do not need a full OpenClaw Gateway or model API key inside a macOS VM just to make the VM own Chrome. Run the Gateway and agent locally, then run a node host in the VM. Enable the bundled `zoom` and `browser` plugins on the VM once so the node advertises the Chrome commands.

Install the VM dependencies:

```bash
brew install blackhole-2ch sox
```

Reboot the VM after installing BlackHole so macOS exposes `BlackHole 2ch`:

```bash
sudo reboot
```

Enable the bundled plugins on the node host:

```bash
openclaw plugins enable browser
openclaw plugins enable zoom
```

Start the node host:

```bash
openclaw node run --host <gateway-host> --port 18789 --display-name zoom-macos
```

If `<gateway-host>` is a LAN IP and you are not using TLS, the node refuses the plaintext WebSocket unless you opt in for that trusted private network:

```bash
OPENCLAW_ALLOW_INSECURE_PRIVATE_WS=1 \
  openclaw node run --host <gateway-lan-ip> --port 18789 --display-name zoom-macos
```

Approve the node from the Gateway host:

```bash
openclaw devices list
openclaw devices approve <requestId>
```

Confirm the Gateway sees the node and that it advertises both `zoom.chrome` and browser capability/`browser.proxy`:

```bash
openclaw nodes status
```

Route Zoom through that node on the Gateway host:

```json5
{
  gateway: {
    nodes: {
      allowCommands: ["zoom.chrome", "browser.proxy"],
    },
  },
  plugins: {
    entries: {
      zoom: {
        enabled: true,
        config: {
          name: "OpenClaw Agent",
          defaultTransport: "chrome-node",
          chrome: { autoJoin: true, reuseExistingTab: true },
          chromeNode: {
            node: "zoom-macos",
          },
        },
      },
    },
  },
}
```

Now join normally from the Gateway host:

```bash
openclaw zoom join 'https://example.zoom.us/j/123456789?pwd=...'
```

For a one-command smoke test that creates or reuses a session, speaks a known phrase, and prints session health:

```bash
openclaw zoom test-speech 'https://example.zoom.us/j/123456789?pwd=...'
```

## Browser join behavior

The plugin uses conservative browser automation. It may click Zoom's browser-join control, fill the configured display name, keep camera off, select BlackHole 2ch for visible microphone/speaker choices, click Join, and click the computer-audio join control when those controls are clearly visible. It does not guess passcodes or bypass waiting rooms. `zoom.leave` clicks visible leave controls when possible and closes the matching Zoom tab after stopping the audio bridge.

When an agent sees `manualActionRequired: true`, it should report the `manualActionMessage` plus the browser node/tab context and stop opening new Zoom tabs until the operator completes the browser step.

Common manual-action reasons:

| Reason                        | Meaning                                                                                                           |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `zoom-browser-join-required`  | Zoom is showing a browser-join control and `chrome.autoJoin` is disabled or automation could not safely continue. |
| `zoom-name-required`          | Zoom needs a display name. Configure `name` or fill the field manually.                                           |
| `zoom-passcode-required`      | Enter the meeting passcode in the browser.                                                                        |
| `zoom-admission-required`     | The participant is in the waiting room or the host has not started/admitted the meeting.                          |
| `zoom-login-required`         | The meeting/account requires Zoom sign-in.                                                                        |
| `zoom-permission-required`    | Chrome or Zoom needs microphone/camera/speaker permission.                                                        |
| `zoom-audio-choice-required`  | Zoom is asking whether to use microphone/camera.                                                                  |
| `zoom-meeting-ended`          | Zoom reports that the meeting has ended.                                                                          |
| `zoom-invalid-meeting`        | Zoom reports that the meeting id or link is invalid.                                                              |
| `browser-control-unavailable` | OpenClaw browser control could not inspect the tab.                                                               |

## Config

Set the plugin config under `plugins.entries.zoom.config`:

```json5
{
  plugins: {
    entries: {
      zoom: {
        enabled: true,
        config: {},
      },
    },
  },
}
```

Defaults:

- `defaultTransport: "chrome"`
- `defaultMode: "realtime"`
- `name`: display name used when Zoom asks for a participant name; falls back to `conversation.agentId`, `realtime.agentId`, then `main`
- `chromeNode.node`: optional node id/name/IP for `chrome-node`
- `chrome.audioBackend: "blackhole-2ch"`
- `chrome.guestName`: legacy alias for `name`
- `chrome.autoJoin: true`
- `chrome.reuseExistingTab: true`
- `chrome.waitForInCallMs: 20000`
- `chrome.audioFormat: "pcm16-24khz"`
- `conversation.provider`: optional provider override for conversation replies, for example `openai-codex` or a configured local provider
- `conversation.model`: optional model override for conversation replies, for example `gpt-5.5` or a configured local model id
- `conversation.playbackCommand: ["sox", "-q", "{{AudioPath}}", "-t", "coreaudio", "BlackHole 2ch"]`
- `conversation.halfDuplex: true`
- `conversation.echoSuppressionMs: 700`
- `conversation.vad.rmsThreshold: 0.003`
- `conversation.vad.silenceMs: 700`
- `realtime.provider: "openai"`
- `realtime.toolPolicy: "safe-read-only"`
- `realtime.instructions`: brief spoken replies, with `openclaw_agent_consult` for deeper answers
- `realtime.introMessage`: short spoken readiness check when the realtime bridge connects; set it to `""` to join silently
- `realtime.agentId`: optional OpenClaw agent id for `openclaw_agent_consult`; defaults to `main`

Optional overrides:

```json5
{
  name: "OpenClaw Agent",
  defaults: {
    meeting: "https://example.zoom.us/j/123456789?pwd=...",
  },
  browser: {
    defaultProfile: "openclaw",
  },
  chrome: {
    waitForInCallMs: 30000,
  },
  chromeNode: {
    node: "zoom-macos",
  },
  realtime: {
    provider: "google",
    agentId: "jay",
    toolPolicy: "owner",
    introMessage: "Say exactly: I'm here.",
  },
}
```

## Tool

Agents can use the `zoom_meeting` tool:

```json
{
  "action": "join",
  "url": "https://example.zoom.us/j/123456789?pwd=...",
  "transport": "chrome-node",
  "mode": "realtime"
}
```

Use `action: "status"` to list active sessions or inspect a session ID. Use `action: "speak"` with `sessionId` and `message` to make the realtime agent speak immediately. Use `action: "test_speech"` to create or reuse the session, trigger a known phrase, and return browser health when the Chrome host can report it. Use `action: "leave"` to mark a session ended.

## Live test checklist

Use this sequence before handing a meeting to an unattended agent:

```bash
openclaw zoom setup
openclaw nodes status
openclaw zoom test-speech 'https://example.zoom.us/j/123456789?pwd=...' \
  --transport chrome-node \
  --message "Say exactly: Zoom speech test complete."
```

Expected Chrome-node state:

- `zoom setup` is all green.
- `zoom setup` includes `chrome-node-connected` when Chrome-node is the default transport or a node is pinned.
- `nodes status` shows the selected node connected.
- The selected node advertises both `zoom.chrome` and `browser.proxy`.
- The Zoom tab joins the meeting or reports a precise manual-action blocker.

## Caveats

Zoom browser joining is account and host-setting dependent. Some meetings may require the native Zoom app, a Zoom login, a passcode, or host admission. The plugin intentionally reports those states as manual-action blockers instead of bypassing them or opening duplicate tabs.
