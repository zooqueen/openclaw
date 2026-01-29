---
name: imessage-bluebubbles
description: iMessage via BlueBubbles REST API (list chats, query history/search, send text + attachments).
homepage: https://bluebubbles.app
metadata: {"moltbot":{"emoji":"💬","requires":{"bins":["curl","jq"]}}}
---

# iMessage (BlueBubbles)

Use the **BlueBubbles Server** REST API to query iMessage chats/messages and send messages/attachments.

This is the recommended iMessage integration for Moltbot.

Requirements
- A macOS host running **BlueBubbles Server**
- BlueBubbles REST API enabled + password set
- Network access from this host to the BlueBubbles Server

Environment variables (recommended)
```bash
export BLUEBUBBLES_SERVER_URL="http://mac-mini.lan:1234"
export BLUEBUBBLES_PASSWORD="..."
```

Quick checks
- Ping:
  ```bash
  curl -s "$BLUEBUBBLES_SERVER_URL/api/v1/ping?password=$BLUEBUBBLES_PASSWORD" | jq
  ```

Common commands

## List chats (with last message)
```bash
curl -sS \
  -X POST "$BLUEBUBBLES_SERVER_URL/api/v1/chat/query?password=$BLUEBUBBLES_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "limit": 50,
    "offset": 0,
    "with": ["lastMessage", "chat.participants"],
    "sort": "lastmessage"
  }' | jq
```

## Query message history (by chatGuid)
```bash
CHAT_GUID='iMessage;-;+15555550123'
curl -sS \
  -X POST "$BLUEBUBBLES_SERVER_URL/api/v1/message/query?password=$BLUEBUBBLES_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg chatGuid "$CHAT_GUID" '{
    limit: 25,
    offset: 0,
    chatGuid: $chatGuid,
    with: ["chat", "chat.participants", "attachment", "handle", "sms"],
    sort: "DESC"
  }')" | jq
```

## Search messages (SQL where clause)
BlueBubbles supports server-side filtering via `where` clauses.

Example: search for an exact text match:
```bash
curl -sS \
  -X POST "$BLUEBUBBLES_SERVER_URL/api/v1/message/query?password=$BLUEBUBBLES_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data '{
    "limit": 25,
    "offset": 0,
    "with": ["chat", "handle"],
    "where": [{
      "statement": "message.text = :text",
      "args": {"text": "Kara and Mimi"}
    }],
    "sort": "DESC"
  }' | jq
```

## Send a text message
Note: prefer using Moltbot's `message` tool when available (it automatically resolves targets and threads).

```bash
CHAT_GUID='iMessage;-;+15555550123'
curl -sS \
  -X POST "$BLUEBUBBLES_SERVER_URL/api/v1/message/text?password=$BLUEBUBBLES_PASSWORD" \
  -H 'Content-Type: application/json' \
  --data "$(jq -n --arg chatGuid "$CHAT_GUID" --arg message "hi" '{
    chatGuid: $chatGuid,
    tempGuid: "temp-" + (now|tostring),
    message: $message
  }')" | jq
```

## Send an attachment
```bash
CHAT_GUID='iMessage;-;+15555550123'
FILE_PATH='/path/to/pic.jpg'

curl -sS \
  -X POST "$BLUEBUBBLES_SERVER_URL/api/v1/message/attachment?password=$BLUEBUBBLES_PASSWORD" \
  -F "attachment=@${FILE_PATH}" \
  -F "chatGuid=${CHAT_GUID}" \
  -F "name=$(basename "$FILE_PATH")" \
  -F "tempGuid=temp-$(date +%s)" \
  -F "method=private-api" | jq
```

## Download an attachment
```bash
ATTACHMENT_GUID='att-123'
curl -L \
  "$BLUEBUBBLES_SERVER_URL/api/v1/attachment/$ATTACHMENT_GUID/download?password=$BLUEBUBBLES_PASSWORD" \
  -o ./download.bin
```

Watch / streaming
- BlueBubbles supports **webhooks** for realtime events.
- In Moltbot, realtime inbound iMessage is handled by the **BlueBubbles channel plugin** (configure `channels.bluebubbles.webhookPath` and point BlueBubbles webhooks at the gateway).

Notes
- Confirm recipient + message before sending.
- Many advanced actions (reactions/edit/unsend/effects/group management) require BlueBubbles **Private API**.
