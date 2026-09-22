import type { JSONContent, MarkdownRendererHelpers } from "@tiptap/core";

type Align = "left" | "right" | "center" | null;
const ALIGNS = new Set(["left", "right", "center"]);

const DELIMITERS: Record<string, (dashes: string) => string> = {
  left: (dashes) => `:${dashes}`,
  right: (dashes) => `${dashes}:`,
  center: (dashes) => `:${dashes}:`,
};

/**
 * A GFM table in the same layout as Tiptap's renderer (padded columns, at least three dashes), but
 * without collapsing runs of spaces, which changed text and code inside cells. The first row is the
 * header row; alignment is per column in markdown, so the first aligned cell of a column sets it.
 */
export function renderTableMarkdown(node: JSONContent, h: MarkdownRendererHelpers): string {
  const rows = (node.content ?? []).map((row) =>
    (row.content ?? []).map((cell) => ({
      // Cell paragraphs render on one line (renderInlineMarkdown's `inTable`).
      text: (cell.content ?? [])
        .map((child, index) => h.renderChild?.(child, index) ?? "")
        .join(" ")
        .trim(),
      align: (ALIGNS.has(cell.attrs?.align) ? cell.attrs?.align : null) as Align,
    })),
  );
  const columns = Math.max(0, ...rows.map((row) => row.length));
  if (columns === 0) return "";
  const indexes = Array.from({ length: columns }, (_, i) => i);
  const widths = indexes.map((i) => Math.max(3, ...rows.map((row) => row[i]?.text.length ?? 0)));
  const aligns = indexes.map((i) => rows.find((row) => row[i]?.align)?.[i].align ?? null);
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const textRow = (row: (typeof rows)[number]) =>
    line(indexes.map((i) => (row[i]?.text ?? "").padEnd(widths[i])));
  const delimiterRow = line(
    indexes.map((i) => {
      const dashes = "-".repeat(widths[i]);
      return aligns[i] ? DELIMITERS[aligns[i]](dashes) : dashes;
    }),
  );
  return [textRow(rows[0]), delimiterRow, ...rows.slice(1).map(textRow)].join("\n");
}
