import { toSafeName } from "@/lib/names";

/** File types offered by the folder menu's "Import .md files…" picker (§17.2). */
export const IMPORT_ACCEPT = ".md,.markdown,.txt,text/markdown,text/x-markdown,text/plain";

/** Note title for an imported file: drop a .md/.markdown/.txt extension, then make the rest a valid name. */
export function noteNameFromFileName(fileName: string): string {
  return toSafeName(fileName.replace(/\.(md|markdown|txt)$/i, ""), "note");
}

/** Toast text after an import, e.g. "Imported 3 notes · 1 skipped". */
export function importSummary(imported: number, skipped: number): string {
  const base = `Imported ${imported} ${imported === 1 ? "note" : "notes"}`;
  return skipped > 0 ? `${base} · ${skipped} skipped` : base;
}
