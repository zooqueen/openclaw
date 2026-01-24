---
summary: "CLI reference for `clawdbot contacts` (unified contact graph)"
read_when:
  - You want to list or link contacts across channels
  - You are using the contacts-search plugin
---

# `clawdbot contacts`

Unified contact graph and identity linking.
Provided by the [Contacts + Search plugin](/plugins/contacts-search).
Concept overview: [Contact graph](/contact).

## Examples

```bash
clawdbot contacts list
clawdbot contacts list --query "sarah" --platform slack
clawdbot contacts show <contact-id>
clawdbot contacts search "alice"
clawdbot contacts link <primary-id> <secondary-id>
clawdbot contacts unlink slack U12345678
clawdbot contacts suggestions
clawdbot contacts auto-link --dry-run
clawdbot contacts stats
clawdbot contacts alias <contact-id> "Alias Name"
clawdbot contacts alias <contact-id> "Old Alias" --remove
```

## Commands

- `list`: list contacts (supports `--query`, `--platform`, `--limit`, `--json`).
- `show <id>`: show a contact + identities (accepts a canonical id or a search query).
- `search <query>`: search contacts by name/alias/username.
- `link <primary> <secondary>`: merge two contacts.
- `unlink <platform> <platformId>`: detach an identity into a new contact.
- `suggestions`: show link suggestions.
- `auto-link`: link high-confidence matches (use `--dry-run` to preview).
- `stats`: store statistics by platform.
- `alias <contactId> <alias>`: add or remove aliases (`--remove`).

## Notes

- `--platform` expects a channel id (e.g. `slack`, `discord`, `whatsapp`).
- `unlink` uses the platform id stored on the identity (not the contact id).
