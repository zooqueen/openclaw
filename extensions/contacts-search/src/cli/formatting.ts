type TableColumn = {
  key: string;
  header: string;
  minWidth?: number;
  flex?: boolean;
};

type TableRow = Record<string, string | number | null | undefined>;

type TableOptions = {
  columns: TableColumn[];
  rows: TableRow[];
  width?: number;
};

const pad = (value: string, width: number) => value.padEnd(width);

const truncate = (value: string, width: number) => {
  if (value.length <= width) return pad(value, width);
  if (width <= 3) return value.slice(0, width);
  return value.slice(0, width - 3) + "...";
};

export const theme = {
  heading: (value: string) => value,
  muted: (value: string) => value,
  accent: (value: string) => value,
  accentBright: (value: string) => value,
};

export const cli = {
  log: (message: string) => {
    // eslint-disable-next-line no-console
    console.log(message);
  },
  error: (message: string) => {
    // eslint-disable-next-line no-console
    console.error(message);
  },
  exit: (code: number) => {
    process.exit(code);
  },
};

export const formatSuccess = (message: string) => message;
export const formatDanger = (message: string) => message;

export function renderTable({ columns, rows, width }: TableOptions): string {
  const widths = columns.map((column) => {
    const headerWidth = column.header.length;
    const minWidth = column.minWidth ?? 0;
    const maxRowWidth = rows.reduce((max, row) => {
      const value = String(row[column.key] ?? "");
      return Math.max(max, value.length);
    }, 0);
    return Math.max(minWidth, headerWidth, maxRowWidth);
  });

  if (width) {
    const baseWidth = widths.reduce((sum, colWidth) => sum + colWidth, 0);
    const totalWidth = baseWidth + (columns.length - 1) * 2;
    if (totalWidth > width) {
      const flexColumns = columns
        .map((column, index) => (column.flex ? index : -1))
        .filter((index) => index >= 0);
      if (flexColumns.length > 0) {
        const excess = totalWidth - width;
        const shrinkEach = Math.ceil(excess / flexColumns.length);
        for (const index of flexColumns) {
          const minWidth = columns[index]!.minWidth ?? 4;
          widths[index] = Math.max(minWidth, widths[index]! - shrinkEach);
        }
      }
    }
  }

  const header = columns
    .map((column, index) => truncate(column.header, widths[index]!))
    .join("  ");
  const separator = columns
    .map((_, index) => "-".repeat(widths[index]!))
    .join("  ");

  const lines = [header, separator];
  for (const row of rows) {
    lines.push(
      columns
        .map((column, index) =>
          truncate(String(row[column.key] ?? ""), widths[index]!),
        )
        .join("  "),
    );
  }

  return lines.join("\n");
}
