---
summary: "Use Gradium text-to-speech in OpenClaw"
read_when:
  - You want Gradium for text-to-speech replies and voice notes
  - You need Gradium API key, voice ids, or output format options
title: "Gradium"
---

Gradium is a bundled text-to-speech provider for OpenClaw. It can generate audio replies, Opus voice notes, and 8 kHz µ-law audio for telephony surfaces, all from the same shared `messages.tts` pipeline.

| Property      | Value                        |
| ------------- | ---------------------------- |
| Provider id   | `gradium`                    |
| Plugin        | bundled                      |
| Auth env var  | `GRADIUM_API_KEY`            |
| Default URL   | `https://api.gradium.ai`     |
| Default voice | `YTpq7expH9539ERJ` (Emma)    |
| Contract      | `speechProviders` (TTS only) |

## Getting started

<Steps>
  <Step title="Set your API key">
    ```bash
    export GRADIUM_API_KEY="gsk_..."
    ```

    Or store it in config under `messages.tts.providers.gradium.apiKey` (SecretRef-friendly).

  </Step>
  <Step title="Select Gradium as the TTS provider">
    ```json5
    {
      messages: {
        tts: {
          auto: "always",
          provider: "gradium",
          providers: {
            gradium: {
              voiceId: "YTpq7expH9539ERJ",
              // apiKey: "${GRADIUM_API_KEY}",
              // baseUrl: "https://api.gradium.ai",
            },
          },
        },
      },
    }
    ```
  </Step>
  <Step title="Trigger a reply">
    Send any message that produces an assistant reply. With `auto: "always"`, OpenClaw renders Gradium TTS for the reply and attaches it to the channel as audio or a voice note.
  </Step>
</Steps>

## Voices

| Name      | Voice ID           |
| --------- | ------------------ |
| Emma      | `YTpq7expH9539ERJ` |
| Kent      | `LFZvm12tW_z0xfGo` |
| Tiffany   | `Eu9iL_CYe8N-Gkx_` |
| Christina | `2H4HY2CBNyJHBCrP` |
| Sydney    | `jtEKaLYNn6iif5PR` |
| John      | `KWJiFWu2O9nMPYcR` |
| Arthur    | `3jUdJyOi9pgbxBTK` |

The default voice is Emma. Set `messages.tts.providers.gradium.voiceId` to switch.

## Output formats

Gradium supports six output formats. OpenClaw selects one per delivery context:

| Format      | Sample rate | Used for                                           |
| ----------- | ----------- | -------------------------------------------------- |
| `wav`       | 44.1 kHz    | Default audio-file replies                         |
| `opus`      | 48 kHz      | Voice-note replies (marked voice-compatible)       |
| `pcm`       | 16 kHz      | Raw PCM, low-latency consumers                     |
| `pcm_24000` | 24 kHz      | Higher-fidelity raw PCM consumers                  |
| `ulaw_8000` | 8 kHz       | Telephony synthesis (voice-call provider playback) |
| `alaw_8000` | 8 kHz       | Telephony synthesis on A-law carriers              |

<Note>
  Format selection is driven by the calling pipeline (audio attachment, voice note, voice call). Gradium does not expose a per-message format override in `messages.tts.providers.gradium`.
</Note>

## Related

<CardGroup cols={2}>
  <Card title="Text-to-speech" href="/tools/tts" icon="volume">
    TTS overview, persona bindings, and provider selection rules.
  </Card>
  <Card title="Media overview" href="/tools/media-overview" icon="layers">
    How OpenClaw handles outbound and inbound media across providers.
  </Card>
</CardGroup>
