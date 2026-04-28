import type { Block, KnownBlock } from "@slack/web-api";
import {
  markdownToIRWithMeta,
  sliceMarkdownIR,
  truncateUtf16Safe,
  type MarkdownIR,
  type MarkdownTableMeta,
} from "openclaw/plugin-sdk/text-runtime";
import { SLACK_MAX_BLOCKS } from "./blocks-input.js";
import { markdownToSlackMrkdwnChunks, renderSlackMrkdwnIRChunks } from "./format.js";

const SLACK_SECTION_TEXT_LIMIT = 3000;
const SLACK_TABLE_MAX_ROWS = 100;
const SLACK_TABLE_MAX_COLUMNS = 20;
const SLACK_TABLE_CELL_TEXT_LIMIT = 3000;

type SlackTableCell = {
  type: "raw_text";
  text: string;
};

type SlackTableBlock = Extract<KnownBlock, { type: "table" }>;

export type SlackBlockKitTableRender = {
  text: string;
  blocks: (Block | KnownBlock)[];
};

function normalizeTableCellText(value: string): string {
  const trimmed = value.replace(/\s+/g, " ").trim();
  return truncateUtf16Safe(trimmed || " ", SLACK_TABLE_CELL_TEXT_LIMIT);
}

function createRawTableCell(value: string): SlackTableCell {
  return {
    type: "raw_text",
    text: normalizeTableCellText(value),
  };
}

function normalizeTableRows(table: MarkdownTableMeta): SlackTableCell[][] {
  const width = Math.min(
    SLACK_TABLE_MAX_COLUMNS,
    Math.max(table.headers.length, ...table.rows.map((row) => row.length)),
  );
  if (width <= 0) {
    return [];
  }

  const rows: SlackTableCell[][] = [];
  if (table.headers.length > 0) {
    rows.push(
      Array.from({ length: width }, (_value, index) =>
        createRawTableCell(table.headers[index] ?? ""),
      ),
    );
  }
  for (const row of table.rows) {
    rows.push(
      Array.from({ length: width }, (_value, index) => createRawTableCell(row[index] ?? "")),
    );
    if (rows.length >= SLACK_TABLE_MAX_ROWS) {
      break;
    }
  }
  return rows;
}

export function buildSlackTableBlock(table: MarkdownTableMeta): SlackTableBlock | null {
  const rows = normalizeTableRows(table);
  if (rows.length === 0) {
    return null;
  }
  const columnCount = rows[0]?.length ?? 0;
  return {
    type: "table",
    rows,
    column_settings: Array.from({ length: columnCount }, () => ({ is_wrapped: true })),
  };
}

function appendSectionBlocks(params: {
  blocks: (Block | KnownBlock)[];
  source: MarkdownIR;
  maxBlocks: number;
}): boolean {
  if (!params.source.text.trim()) {
    return true;
  }
  for (const chunk of renderSlackMrkdwnIRChunks(params.source, SLACK_SECTION_TEXT_LIMIT)) {
    const text = chunk.trim();
    if (!text) {
      continue;
    }
    if (params.blocks.length >= params.maxBlocks) {
      return false;
    }
    params.blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text,
      },
    });
  }
  return true;
}

export function markdownToSlackBlockKitTables(
  markdown: string,
  options: {
    textLimit: number;
    maxBlocks?: number;
  },
): SlackBlockKitTableRender | null {
  const parsed = markdownToIRWithMeta(markdown ?? "", {
    linkify: false,
    autolink: false,
    headingStyle: "bold",
    blockquotePrefix: "> ",
    tableMode: "block",
  });
  if (!parsed.hasTables || parsed.tables.length === 0) {
    return null;
  }

  const maxBlocks = Math.min(options.maxBlocks ?? SLACK_MAX_BLOCKS, SLACK_MAX_BLOCKS);
  const blocks: (Block | KnownBlock)[] = [];
  let cursor = 0;

  for (const table of parsed.tables) {
    const before = sliceMarkdownIR(parsed.ir, cursor, table.placeholderOffset);
    if (
      !appendSectionBlocks({
        blocks,
        source: before,
        maxBlocks,
      })
    ) {
      return null;
    }

    const tableBlock = buildSlackTableBlock(table);
    if (tableBlock) {
      if (blocks.length >= maxBlocks) {
        return null;
      }
      blocks.push(tableBlock);
    }
    cursor = table.placeholderOffset;
  }

  const after = sliceMarkdownIR(parsed.ir, cursor, parsed.ir.text.length);
  if (
    !appendSectionBlocks({
      blocks,
      source: after,
      maxBlocks,
    })
  ) {
    return null;
  }

  if (blocks.length === 0) {
    return null;
  }

  const fallbackText = markdownToSlackMrkdwnChunks(markdown, options.textLimit, {
    tableMode: "code",
  }).join("\n");
  return {
    text: truncateUtf16Safe(
      fallbackText || renderSlackMrkdwnIRChunks(parsed.ir, options.textLimit).join("\n"),
      options.textLimit,
    ),
    blocks,
  };
}
