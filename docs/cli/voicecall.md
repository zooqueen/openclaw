---
summary: "CLI reference for `openclaw voicecall` (voice-call plugin command surface)"
read_when:
  - You use the voice-call plugin and want the CLI entry points
  - You need quick examples for every voicecall subcommand
title: "Voicecall"
---

# `openclaw voicecall`

`voicecall` is provided by the voice-call plugin, so the namespace only appears once that plugin is installed and enabled.

When the Gateway is running, operational subcommands route through it via the `voicecall.*` JSON-RPC methods (`voicecall.start`, `voicecall.continue.start`, `voicecall.speak`, `voicecall.dtmf`, `voicecall.end`, `voicecall.status`). If the Gateway is unreachable, the same commands fall back to a standalone CLI runtime backed by the local call manager.

Primary doc: [Voice call plugin](/plugins/voice-call).

## Subcommand summary

| Command              | Purpose                                                           |
| -------------------- | ----------------------------------------------------------------- |
| `voicecall setup`    | Print provider and webhook readiness checks                       |
| `voicecall smoke`    | Run readiness checks, optionally place a short outbound test call |
| `voicecall call`     | Start an outbound call (`--message` required)                     |
| `voicecall start`    | Alias for `call` (requires `--to`, `--message` optional)          |
| `voicecall continue` | Speak a message and wait for the next caller turn                 |
| `voicecall speak`    | Speak a message without waiting for a response                    |
| `voicecall dtmf`     | Send DTMF digits to an active call                                |
| `voicecall end`      | Hang up an active call                                            |
| `voicecall status`   | Inspect active calls (or one call with `--call-id`)               |
| `voicecall tail`     | Tail the call JSONL log file                                      |
| `voicecall latency`  | Summarize turn latency metrics from the JSONL log                 |
| `voicecall expose`   | Toggle Tailscale serve/funnel exposure for the webhook            |

## Setup and readiness

```bash
openclaw voicecall setup
openclaw voicecall setup --json
```

`setup` prints human-readable readiness checks by default. Pass `--json` for scripting.

For external providers (`twilio`, `telnyx`, `plivo`), setup must resolve a public webhook URL from `publicUrl`, a tunnel, or a Tailscale exposure. Loopback or private-only serves are rejected because carriers cannot reach them.

## Smoke test

`smoke` runs the same readiness checks. It only places a real call when both `--to` and `--yes` are present:

```bash
openclaw voicecall smoke                           # readiness only
openclaw voicecall smoke --to "+15555550123"       # dry run for the number
openclaw voicecall smoke --to "+15555550123" --yes # live notify call
```

Options: `--to`, `--message` (default `OpenClaw voice call smoke test.`), `--mode` (default `notify`), `--yes`, `--json`.

## Placing calls

```bash
# Required --message; --to falls back to the configured toNumber
openclaw voicecall call --message "Hello" --to "+15555550123"

# Alias of call: --to required, --message optional
openclaw voicecall start --to "+15555550123" --message "Calling now"
```

`call` defaults to `--mode conversation` (stays open after the message). Use `--mode notify` to hang up after the prompt is spoken.

## Driving an active call

```bash
openclaw voicecall continue --call-id <id> --message "Any questions?"
openclaw voicecall speak    --call-id <id> --message "One moment please"
openclaw voicecall dtmf     --call-id <id> --digits "ww123456#"
openclaw voicecall end      --call-id <id>
```

`continue` waits for the caller's next turn before returning. `speak` returns immediately after the message is queued.

## Inspecting calls

```bash
openclaw voicecall status              # all active calls (JSON)
openclaw voicecall status --call-id <id>
openclaw voicecall status --json
```

When `--call-id` matches no active call, the gateway path returns `{ "found": false }` and the runtime fallback returns the same shape.

## Logs and metrics

```bash
openclaw voicecall tail
openclaw voicecall tail --since 50 --poll 500
openclaw voicecall tail --file /path/to/calls.jsonl

openclaw voicecall latency                      # summarize last 200 records
openclaw voicecall latency --last 1000
```

`tail` polls a JSONL file (default: `calls.jsonl` in the configured store path) and prints new lines as they arrive. `latency` reads `lastTurnLatencyMs` and `lastTurnListenWaitMs` metadata from those records and emits a summary JSON payload.

## Exposing the webhook

```bash
openclaw voicecall expose --mode serve   # tailnet-only (recommended)
openclaw voicecall expose --mode funnel  # public via Tailscale Funnel
openclaw voicecall expose --mode off     # disable serve and funnel routes
```

Defaults come from `serve.port` (`3334`) and `serve.path` (`/voice/webhook`). Override with `--port`, `--serve-path`, or `--path`.

<Warning>
  Only expose the webhook to networks you trust. Prefer Tailscale Serve over Funnel when possible — Funnel publishes the webhook publicly to the internet.
</Warning>

## Related

- [CLI reference](/cli)
- [Voice call plugin](/plugins/voice-call)
