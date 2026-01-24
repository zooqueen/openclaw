---
summary: "Unified contacts: contact graph, identity linking, and message indexing"
read_when:
  - You want to understand how Clawdbot merges identities across channels
  - You are using the Contacts + Search plugin
---

# Contact graph

Clawdbot can maintain a **unified contact graph** that links the same person across multiple channels (Slack, Discord, WhatsApp, etc.).
This powers cross-platform message search and manual identity linking.

The contact graph is provided by the **Contacts + Search** plugin and is **disabled by default**.

## Enable

Install/enable the plugin on the **Gateway host**, then restart the Gateway.

```bash
clawdbot plugins enable contacts-search
```

Config equivalent:

```json5
{
  plugins: {
    entries: {
      "contacts-search": { enabled: true }
    }
  }
}
```

Related:
- [Contacts + Search plugin](/plugins/contacts-search)
- [Plugins overview](/plugin)

## Data model

The contact graph has three layers:

1) **Canonical contact**
- One logical person.
- Has a `canonicalId`, display name, and optional aliases.

2) **Platform identity**
- One account on one channel (e.g. `slack:U123...`).
- Links back to a canonical contact.
- Optional username, phone, display name, and last-seen time.

3) **Indexed message**
- Text of inbound messages tied to a platform identity.
- Used by cross-platform search.

## How contacts are created

Contacts are created automatically when **inbound messages** arrive:

- The plugin extracts sender identity details from the inbound message.
- If the platform identity is new, a new canonical contact is created.
- If it already exists, the identity metadata is refreshed.

There is **no backfill** step today; indexing starts when the plugin is enabled.

## Linking identities

You can link identities that belong to the same person:

- **Manual link**: merge two contacts into one canonical contact.
- **Suggestions**: name/phone similarity hints (preview-only).
- **Auto-link**: high-confidence matches (same phone number).

CLI reference: [Contacts CLI](/cli/contacts)

## Searching messages

Use the CLI or slash command:

- `clawdbot search "query"` (CLI)
- `/search <query>` (chat)

Search uses SQLite FTS when available; otherwise it falls back to SQL `LIKE`.

CLI reference: [Search CLI](/cli/search)
Slash commands: [Slash commands](/tools/slash-commands)

## Storage + privacy

- Stored locally on the Gateway host at `~/.clawdbot/contacts/contacts.sqlite`.
- No cloud sync by default.
- Treat this file as **sensitive** (names, handles, phone numbers).

To reset the graph, disable the plugin and move the SQLite file to Trash, then restart the Gateway.

## Troubleshooting

- **No results**: the plugin only indexes **new inbound messages**.
- **Missing contacts**: ensure the plugin is enabled and the Gateway restarted.
- **Search feels shallow**: FTS may be unavailable; check that SQLite FTS5 is supported on your runtime.
