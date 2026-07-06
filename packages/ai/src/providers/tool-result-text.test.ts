import { describe, expect, it } from "vitest";
import { describeToolResultMediaPlaceholder, extractToolResultText } from "./tool-result-text.js";

describe("extractToolResultText", () => {
  it("keeps media-only blocks out of provider replay text", () => {
    const text = extractToolResultText([
      { type: "text", text: "summary" },
      { type: "image", data: "image-binary", mimeType: "image/png" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
      { type: "input_image", image_url: "data:image/png;base64,def456" },
      { type: "audio", data: "audio-binary", mimeType: "audio/mpeg" },
    ]);

    expect(text).toBe("summary");
    expect(text).not.toContain("image-binary");
    expect(text).not.toContain("abc123");
    expect(text).not.toContain("def456");
    expect(text).not.toContain("audio-binary");
  });

  it("omits MIME-tagged binary data while preserving textual resource data", () => {
    const text = extractToolResultText([
      { type: "resource", mime_type: "application/octet-stream", data: "AAECAwQFBgc=" },
      { type: "resource", mediaType: "application/json", data: '{"ok":true}' },
    ]);

    expect(text).toContain('"data":"[binary data omitted: 12 chars]"');
    expect(text).toContain('{\\"ok\\":true}');
    expect(text).not.toContain("AAECAwQFBgc=");
  });

  it("redacts inline data URIs without touching ordinary data-colon prose", () => {
    const text = extractToolResultText([
      {
        type: "json",
        value: {
          note: "metadata:ready",
          prose: "data: is ordinary prose",
          preview: "thumbnail=data:image/png;base64,abcdef done",
        },
      },
    ]);

    expect(text).toContain("metadata:ready");
    expect(text).toContain("data: is ordinary prose");
    expect(text).toContain("[inline data URI:");
    expect(text).not.toContain("abcdef");
  });

  it("omits opaque or binary structured fields", () => {
    const text = extractToolResultText([
      {
        type: "json",
        encrypted_content: "ciphertext",
        bytes: [1, 2, 3],
        visible: "safe-value",
      },
    ]);

    expect(text).toContain('"encrypted_content":"[omitted encrypted_content]"');
    expect(text).toContain('"bytes":"[omitted bytes]"');
    expect(text).toContain('"visible":"safe-value"');
    expect(text).not.toContain("ciphertext");
  });

  it("uses structured replay only as a no-text fallback without capping explicit text", () => {
    const textTail = "explicit-tail-marker";
    const text = extractToolResultText([
      { type: "text", text: `${"x".repeat(8_200)}${textTail}` },
      { type: "json", internal: "extra structured detail" },
    ]);

    expect(text).toContain(textTail);
    expect(text).not.toContain("…(truncated)…");
    expect(text).not.toContain("extra structured detail");
  });

  it("truncates structured fallback text before provider replay", () => {
    const tail = "tail-marker";
    const text = extractToolResultText([
      {
        type: "json",
        data: {
          payload: `${"x".repeat(8_200)}${tail}`,
        },
      },
    ]);

    expect(text.length).toBeLessThan(8_100);
    expect(text).toContain("…(truncated)…");
    expect(text).not.toContain(tail);
  });

  it("replaces payload-less media blocks with readable placeholders instead of dropping them (#98673)", () => {
    expect(extractToolResultText([{ type: "image", data: "", mimeType: "image/png" }])).toBe(
      "[image omitted: missing payload]",
    );
    expect(extractToolResultText([{ type: "image" }])).toBe("[image omitted: missing payload]");
    expect(extractToolResultText([{ type: "input_audio" }])).toBe(
      "[audio omitted: missing payload]",
    );
  });

  it("keeps sibling text and suppresses the husk placeholder when explicit text exists", () => {
    const text = extractToolResultText([
      { type: "text", text: "actual tool output" },
      { type: "image_url" },
    ]);

    expect(text).toBe("actual tool output");
  });

  it("excludes wire-format media payloads without leaking them into replay text", () => {
    const payload = "QUJD".repeat(1_500);
    const text = extractToolResultText([
      { type: "image", source: { type: "base64", media_type: "image/png", data: payload } },
      { type: "output_audio", audio: { data: payload } },
      { type: "input_audio", input_audio: payload },
    ]);

    expect(text).toBe("");
    expect(text).not.toContain(payload);
  });

  it("excludes file-referenced media blocks from replay text", () => {
    expect(extractToolResultText([{ type: "input_image", file_id: "file-abc123" }])).toBe("");
  });
});

describe("describeToolResultMediaPlaceholder", () => {
  it("describes image-only tool result media", () => {
    expect(
      describeToolResultMediaPlaceholder([{ type: "image", mimeType: "image/png", data: "img" }]),
    ).toBe("(see attached image)");
  });

  it("describes audio-only tool result media", () => {
    expect(
      describeToolResultMediaPlaceholder([
        { type: "audio", mimeType: "audio/mpeg", data: "audio" },
      ]),
    ).toBe("(see attached audio)");
  });

  it("describes mixed image and audio tool result media", () => {
    expect(
      describeToolResultMediaPlaceholder([
        { type: "image", mimeType: "image/png", data: "img" },
        { type: "audio", mimeType: "audio/mpeg", data: "audio" },
      ]),
    ).toBe("(see attached media)");
  });

  it("does not advertise payload-less media husks (#98673)", () => {
    expect(
      describeToolResultMediaPlaceholder([{ type: "image", data: "", mimeType: "image/png" }]),
    ).toBeUndefined();
    expect(describeToolResultMediaPlaceholder([{ type: "image" }])).toBeUndefined();
    expect(
      describeToolResultMediaPlaceholder([{ type: "audio", mimeType: "audio/mpeg" }]),
    ).toBeUndefined();
  });

  it("does not treat a text block's own mime metadata as attached media", () => {
    expect(
      describeToolResultMediaPlaceholder([
        { type: "text", text: "<svg>...</svg>", mimeType: "image/svg+xml" },
      ]),
    ).toBeUndefined();
  });

  it("recognizes wire-format payload shapes as genuine media", () => {
    expect(
      describeToolResultMediaPlaceholder([
        { type: "image", source: { type: "base64", media_type: "image/png", data: "aW1n" } },
      ]),
    ).toBe("(see attached image)");
    expect(
      describeToolResultMediaPlaceholder([
        { type: "image", source: { type: "url", url: "https://example.com/a.png" } },
      ]),
    ).toBe("(see attached image)");
    expect(
      describeToolResultMediaPlaceholder([{ type: "output_audio", audio: { data: "YXVkaW8=" } }]),
    ).toBe("(see attached audio)");
    expect(
      describeToolResultMediaPlaceholder([{ type: "input_audio", input_audio: "YXVkaW8=" }]),
    ).toBe("(see attached audio)");
    expect(
      describeToolResultMediaPlaceholder([
        { type: "input_audio", audio_url: "https://example.com/a.wav" },
      ]),
    ).toBe("(see attached audio)");
    expect(describeToolResultMediaPlaceholder([{ type: "input_image", file_id: "file-abc" }])).toBe(
      "(see attached image)",
    );
    expect(
      describeToolResultMediaPlaceholder([
        { type: "image_url", image_url: { url: "https://example.com/b.png" } },
      ]),
    ).toBe("(see attached image)");
  });

  it("advertises mime-tagged non-text blocks only when they carry a payload", () => {
    expect(describeToolResultMediaPlaceholder([{ mimeType: "image/png", data: "img" }])).toBe(
      "(see attached image)",
    );
    expect(describeToolResultMediaPlaceholder([{ mimeType: "image/png" }])).toBeUndefined();
  });
});
