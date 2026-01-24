---
summary: "Contacts + Search plugin: unified contacts and cross-platform message search"
read_when:
  - You want unified contacts or cross-platform message search
  - You are enabling the contacts-search plugin
---

# Contacts + Search (plugin)

Unified contact graph + cross-platform message search.
Indexes incoming messages, links platform identities, and exposes `/search` plus CLI tools.

## What it adds

- `clawdbot contacts ...` (link, list, search, stats)
- `clawdbot search ...` (message search)
- `/search ...` slash command (text surfaces)

## Where it runs

Runs inside the Gateway process. Enable it on the **Gateway host**, then restart the Gateway.

## Enable (bundled)

```bash
clawdbot plugins enable contacts-search
```

Or in config:

```json5
{
  plugins: {
    entries: {
      "contacts-search": { enabled: true }
    }
  }
}
```

Restart the Gateway after enabling.

## Data location

The contact store lives under the Clawdbot state directory:

- `~/.clawdbot/contacts/contacts.sqlite`

If you run with `--profile <name>` or `--dev`, the state root changes accordingly.

## Indexing notes

- Messages are indexed as they arrive (no backfill).
- Search uses SQLite FTS when available; otherwise falls back to SQL `LIKE` queries.

## CLI quickstart

```bash
clawdbot contacts list
clawdbot contacts search "sarah"
clawdbot contacts show <contact-id>
clawdbot search "meeting notes" --from sarah --since 1w
```

Related:
- CLI: [contacts](/cli/contacts)
- CLI: [search](/cli/search)
- Concept: [Contact graph](/contact)
- Slash commands: [Slash commands](/tools/slash-commands)
- Plugins: [Plugins](/plugin)
