# MiniMax OAuth (Clawdbot plugin)

OAuth provider plugin for **MiniMax** (free-tier OAuth).

## Enable

Bundled plugins are disabled by default. Enable this one:

```bash
clawdbot plugins enable minimax-portal-auth
```

Restart the Gateway after enabling.

## Authenticate

### Global Endpoint (global user)

Uses `api.minimax.io`:

```bash
clawdbot models auth login --provider minimax-portal --set-default
```

### China Endpoint

Uses `api.minimaxi.com`:

```bash
clawdbot models auth login --provider minimax-portal --auth-id oauth-cn --set-default
```

## Notes

- MiniMax OAuth uses a device-code login flow.
- Tokens auto-refresh; re-run login if refresh fails or access is revoked.
- Global endpoint: `api.minimax.io` (default)
- China endpoint: `api.minimax.chat` (use `--auth-id oauth-cn`)
