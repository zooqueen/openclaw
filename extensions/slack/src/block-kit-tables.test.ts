import { describe, expect, it } from "vitest";
import { buildSlackTableBlock, markdownToSlackBlockKitTables } from "./block-kit-tables.js";

describe("buildSlackTableBlock", () => {
  it("renders markdown table metadata as a Slack table block", () => {
    expect(
      buildSlackTableBlock({
        headers: ["Name", "Age"],
        rows: [["Alice", "30"]],
        placeholderOffset: 0,
      }),
    ).toEqual({
      type: "table",
      rows: [
        [
          { type: "raw_text", text: "Name" },
          { type: "raw_text", text: "Age" },
        ],
        [
          { type: "raw_text", text: "Alice" },
          { type: "raw_text", text: "30" },
        ],
      ],
      column_settings: [{ is_wrapped: true }, { is_wrapped: true }],
    });
  });

  it("caps rows, columns, and cell text for Slack table limits", () => {
    const block = buildSlackTableBlock({
      headers: Array.from({ length: 25 }, (_value, index) => `H${index}`),
      rows: Array.from({ length: 120 }, (_value, rowIndex) =>
        Array.from({ length: 25 }, (_cell, cellIndex) =>
          cellIndex === 0 ? "x".repeat(3200) : `${rowIndex}:${cellIndex}`,
        ),
      ),
      placeholderOffset: 0,
    });

    expect(block?.rows).toHaveLength(100);
    expect(block?.rows[0]).toHaveLength(20);
    expect(block?.rows[1]?.[0]).toMatchObject({ text: "x".repeat(3000) });
  });
});

describe("markdownToSlackBlockKitTables", () => {
  it("interleaves surrounding markdown sections with Slack table blocks", () => {
    const rendered = markdownToSlackBlockKitTables(
      "**Before**\n\n| Name | Age |\n|---|---|\n| Alice | 30 |\n\n_After_",
      { textLimit: 8000 },
    );

    expect(rendered?.blocks).toEqual([
      {
        type: "section",
        text: { type: "mrkdwn", text: "*Before*" },
      },
      {
        type: "table",
        rows: [
          [
            { type: "raw_text", text: "Name" },
            { type: "raw_text", text: "Age" },
          ],
          [
            { type: "raw_text", text: "Alice" },
            { type: "raw_text", text: "30" },
          ],
        ],
        column_settings: [{ is_wrapped: true }, { is_wrapped: true }],
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: "_After_" },
      },
    ]);
    expect(rendered?.text).toContain("```");
    expect(rendered?.text).toContain("| Name ");
  });

  it("returns null when block rendering would exceed the Slack block count", () => {
    const markdown = Array.from(
      { length: 51 },
      (_value, index) => `| A${index} |\n|---|\n| B${index} |`,
    ).join("\n\n");

    expect(markdownToSlackBlockKitTables(markdown, { textLimit: 8000, maxBlocks: 50 })).toBeNull();
  });
});
