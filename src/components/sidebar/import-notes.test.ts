import { describe, expect, it } from "vitest";
import { validateName } from "@/lib/names";
import { importSummary, noteNameFromFileName } from "./import-notes";

describe("noteNameFromFileName", () => {
  it("strips one markdown or text extension in any case", () => {
    expect(noteNameFromFileName("Meeting notes.md")).toBe("Meeting notes");
    expect(noteNameFromFileName("Plan.MARKDOWN")).toBe("Plan");
    expect(noteNameFromFileName("todo.Txt")).toBe("todo");
    expect(noteNameFromFileName("archive.tar")).toBe("archive.tar");
  });

  it("always returns a name the server accepts", () => {
    for (const input of [
      "a:b?.md",
      ".hidden.md",
      "CON.md",
      ".md",
      "   ",
      "trailing..txt",
      "x".repeat(300) + ".md",
    ]) {
      const name = noteNameFromFileName(input);
      expect(validateName(name, "note")).toEqual({ ok: true, name });
    }
  });
});

describe("importSummary", () => {
  it("pluralizes and mentions skipped files only when there are some", () => {
    expect(importSummary(1, 0)).toBe("Imported 1 note");
    expect(importSummary(3, 0)).toBe("Imported 3 notes");
    expect(importSummary(0, 2)).toBe("Imported 0 notes · 2 skipped");
  });
});
