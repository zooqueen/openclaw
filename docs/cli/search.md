---
summary: "CLI reference for `clawdbot search` (cross-platform message search)"
read_when:
  - You want to search indexed messages across channels
  - You are using the contacts-search plugin
---

# `clawdbot search`

Search indexed messages across channels.
Provided by the [Contacts + Search plugin](/plugins/contacts-search).

## Examples

```bash
clawdbot search "meeting tomorrow"
clawdbot search "deadline" --from alice
clawdbot search "project" --platform slack --since 1w
clawdbot search "invoice" --since 2025-12-01 --until 2025-12-31
clawdbot search "handoff" --limit 50 --json
```

## Options

- `--from <contact>`: filter by sender name/alias/username or contact id.
- `--platform <name>`: filter by channel id (e.g. `slack`, `discord`, `whatsapp`).
- `--since <time>`: start time (`1h`, `2d`, `1w`, `1m`, or ISO date).
- `--until <time>`: end time (same formats as `--since`).
- `--limit <n>`: limit results (default `20`).
- `--json`: raw JSON output.

## Notes

- Results come from the local contacts store (`~/.clawdbot/contacts/contacts.sqlite`).
- Only inbound messages are indexed (no backfill).
- Concept overview: [Contact graph](/contact).
