---
summary: "CLI reference for `openclaw tui` (Gateway-backed or local embedded terminal UI)"
read_when:
  - You want a terminal UI for the Gateway (remote-friendly)
  - You want to run the TUI in local embedded mode without a Gateway
  - You want to invoke chat or terminal aliases
title: "TUI"
---

# `openclaw tui`

Open the OpenClaw terminal UI against a running Gateway, or run it embedded in the local agent runtime when no Gateway is available.

## Aliases

`openclaw chat` and `openclaw terminal` invoke the same command in local mode (`--local` is implied). Use `openclaw tui` (without `--local`) for the gateway-backed mode.

## Options

| Option                | Default                          | Description                                                       |
| --------------------- | -------------------------------- | ----------------------------------------------------------------- |
| `--local`             | `false`                          | Run against the local embedded agent runtime instead of a Gateway |
| `--url <url>`         | `gateway.remote.url`             | Gateway WebSocket URL                                             |
| `--token <token>`     | resolved from config             | Gateway token (when required)                                     |
| `--password <pwd>`    | resolved from config             | Gateway password (when required)                                  |
| `--session <key>`     | `main`                           | Session key. Use `agent:<id>:<key>` to pin to a specific agent    |
| `--deliver`           | `false`                          | Deliver assistant replies through configured channels             |
| `--thinking <level>`  | inherited                        | Thinking level override                                           |
| `--message <text>`    | none                             | Send an initial message after connecting                          |
| `--timeout-ms <ms>`   | `agents.defaults.timeoutSeconds` | Agent timeout in milliseconds                                     |
| `--history-limit <n>` | `200`                            | History entries to load                                           |

## Examples

```bash
# Local embedded mode
openclaw chat
openclaw tui --local
openclaw chat --message "Compare my config to the docs and tell me what to fix"

# Gateway-backed mode
openclaw tui
openclaw tui --url ws://127.0.0.1:18789 --token "$OPENCLAW_GATEWAY_TOKEN"
openclaw tui --session main --deliver
openclaw tui --session bugfix --history-limit 500
```

When run inside a configured agent workspace, the TUI infers that agent for the session key default unless `--session` already targets `agent:<id>:...`.

<Note>
  `--local` cannot be combined with `--url`, `--token`, or `--password`. The CLI rejects the combination at startup.
</Note>

## Behavior notes

- `tui` resolves configured Gateway auth SecretRefs for token and password auth when possible (`env`, `file`, and `exec` providers).
- Local mode uses the embedded agent runtime directly. Most local tools work, but Gateway-only features (cross-agent routing, persistent task ledger writes from this TUI session, distributed presence) are unavailable.
- Local mode adds an `/auth [provider]` slash command inside the TUI command surface for ad hoc provider sign-in.
- Plugin approval gates still apply in local mode. Tools that require approval prompt for a decision in the terminal; nothing is silently auto-approved because the Gateway is not involved.

## Config repair loop

Use local mode when the current config validates and you want the embedded agent to inspect it, compare it against the docs, and help repair it from the same terminal. If `openclaw config validate` is already failing, run `openclaw configure` or `openclaw doctor --fix` first; `openclaw chat` does not bypass the invalid-config guard.

```bash
openclaw chat
```

Then inside the TUI:

```text
!openclaw config file
!openclaw docs gateway auth token secretref
!openclaw config validate
!openclaw doctor
```

Apply targeted fixes with `openclaw config set` or `openclaw configure`, then rerun `openclaw config validate`.

## Related

<CardGroup cols={2}>
  <Card title="TUI guide" href="/web/tui" icon="terminal">
    Keybindings, layouts, and slash commands inside the TUI.
  </Card>
  <Card title="Config" href="/cli/config" icon="gear">
    `openclaw config` reference.
  </Card>
  <Card title="CLI reference" href="/cli" icon="square-terminal">
    Full CLI command index.
  </Card>
  <Card title="Doctor" href="/cli/doctor" icon="stethoscope">
    Diagnose and repair common config issues.
  </Card>
</CardGroup>
