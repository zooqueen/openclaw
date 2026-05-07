---
summary: "CLI reference for `openclaw directory` (self, peers, groups)"
read_when:
  - You want to look up contact, group, or self IDs for a channel
  - You are developing a channel directory adapter
title: "Directory"
---

# `openclaw directory`

Look up contact, group, and self IDs for chat channels that expose a directory adapter. Use the IDs you find here as `--target` values for `openclaw message send` and other commands that take channel addresses.

## Subcommands

| Command                    | What it lists                                           |
| -------------------------- | ------------------------------------------------------- |
| `directory self`           | The connected account identity for the selected channel |
| `directory peers list`     | Contacts/users (DM-eligible peers)                      |
| `directory groups list`    | Groups, rooms, channels, or conversations               |
| `directory groups members` | Members of a single group, scoped by `--group-id`       |

## Common flags

- `--channel <name>`: channel id or alias. Auto-selected when only one channel is configured.
- `--account <id>`: account id. Defaults to the channel's default account.
- `--json`: emit JSON instead of the table view.

`peers list` and `groups list` also accept:

- `--query <text>`: optional case-insensitive substring filter.
- `--limit <n>`: cap result count (positive integer).

`groups members` requires `--group-id <id>` (the group id from `groups list`) and accepts `--limit <n>`.

## How results are produced

Channels implement directory lookups in one of two ways:

- **Live**: a `*Live` adapter calls the provider API at runtime (Slack, Discord, Microsoft Teams, Matrix, Mattermost, Feishu, Zalo Personal).
- **Config-backed**: results are derived from the account's `allowFrom` list and configured `groups` map (WhatsApp, Telegram). The data reflects what you have already configured, not a live provider directory.

If a channel ships without a directory adapter, the CLI reports the unsupported operation rather than reinstalling the plugin.

## Using results with `message send`

```bash
openclaw directory peers list --channel slack --query "alice"
openclaw message send --channel slack --target user:U012ABCDEF --message "hello"
```

## ID formats by channel

The `id` returned by each directory adapter is exactly what `--target` accepts.

| Channel         | Peer id                               | Group id                                           |
| --------------- | ------------------------------------- | -------------------------------------------------- |
| Slack           | `user:U…`                             | `channel:C…`                                       |
| Discord         | `user:<snowflake>`                    | `channel:<snowflake>`                              |
| Microsoft Teams | `user:<aadObjectId>`                  | `team:<teamId>` or `conversation:<channelId>`      |
| Matrix          | `user:@user:server`                   | `room:!roomId:server` or `#alias:server`           |
| Mattermost      | `user:<userId>`                       | `channel:<channelId>`                              |
| Feishu          | `<open_id>` (raw, no prefix)          | `<chat_id>` (raw `oc_…`)                           |
| WhatsApp        | `+15551234567` (E.164 DM)             | `1234567890-1234567890@g.us`, `120363…@newsletter` |
| Telegram        | `@username` or numeric chat id        | numeric chat id                                    |
| Zalo (Bot API)  | numeric Zalo user id                  | n/a                                                |
| Zalo Personal   | `zca` thread id (`me`, friend, group) | `zca` thread id                                    |

## Examples

### Self ("me")

```bash
openclaw directory self --channel slack
openclaw directory self --channel zalouser --json
```

### Peers (contacts and users)

```bash
openclaw directory peers list --channel slack
openclaw directory peers list --channel slack --query "alice"
openclaw directory peers list --channel feishu --limit 50 --json
```

### Groups

```bash
openclaw directory groups list --channel discord
openclaw directory groups list --channel zalouser --query "work"
openclaw directory groups members --channel discord --group-id 123456789012345678
```

## Output format

The default rendering is a two-column table (`ID`, `Name`) sized to the terminal width. With `--json`, each entry is emitted with at least `{ id, name? }`; live adapters may include extra fields such as `kind`, `avatarUrl`, or a provider-specific `raw` payload.

## Related

- [`openclaw message send`](/cli/message)
- [CLI reference](/cli)
- [Channels overview](/channels)
