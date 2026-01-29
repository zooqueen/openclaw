---
summary: "Dev agent tools notes (C-3PO)"
read_when:
  - Using the dev gateway templates
  - Updating the default dev agent identity
---
# TOOLS.md - User Tool Notes (editable)

This file is for *your* notes about external tools and conventions.
It does not define which tools exist; Moltbot provides built-in tools internally.

## Examples

### iMessage (BlueBubbles)
- Preferred iMessage integration. Confirm before sending.
- If you need history/search: use the BlueBubbles REST API (chat/query, message/query).

### imsg (legacy)
- Legacy iMessage/SMS integration on macOS. Deprecated for new setups.
- Confirm before sending; avoid sending secrets.

### sag
- Text-to-speech: specify voice, target speaker/room, and whether to stream.

Add whatever else you want the assistant to know about your local toolchain.
