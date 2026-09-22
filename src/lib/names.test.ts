import { describe, expect, it } from "vitest";
import { MAX_NAME_BYTES, UNTITLED } from "./constants";
import {
  byteLength,
  compareNames,
  isSafeSegment,
  nameKey,
  normalizeName,
  toSafeName,
  uniqueName,
  validateName,
  type NameKind,
  type NameProblem,
} from "./names";

// Invisible characters are built from code points so they can't be lost or mangled by editors.
const ch = (...codePoints: number[]) => String.fromCodePoint(...codePoints);
const NUL = ch(0x00);
const BELL = ch(0x07);
const ZWSP = ch(0x200b);
const RLO = ch(0x202e);
const COMBINING_ACUTE = ch(0x301);

const problemOf = (input: string, kind: NameKind = "note"): NameProblem | "ok" => {
  const check = validateName(input, kind);
  return check.ok ? "ok" : check.problem;
};

describe("validateName", () => {
  it.each<[string, NameProblem | "ok"]>([
    ["Meeting notes", "ok"],
    ["", "empty"],
    ["   ", "empty"],
    [".md", "empty"],
    ["a".repeat(MAX_NAME_BYTES), "ok"],
    ["a".repeat(MAX_NAME_BYTES + 1), "too_long"],
    [`a${NUL}b`, "control_char"],
    [`a${BELL}b`, "control_char"],
    [`a${ZWSP}b`, "control_char"],
    [`evil${RLO}txt`, "control_char"],
    [".hidden", "leading_dot"],
    ["..", "leading_dot"],
    ["name.", "trailing_dot"],
    ["CON", "reserved"],
    ["con.txt", "reserved"],
    ["CON.md", "reserved"],
    ["lpt1", "reserved"],
    ["COM¹", "reserved"],
    ["Console", "ok"],
    ["a:b", "invalid_char"],
  ])("%j → %s", (input, expected) => {
    expect(problemOf(input)).toBe(expected);
  });

  it.each(["/", "\\", ":", "*", "?", '"', "<", ">", "|"])("rejects %j as invalid_char", (c) => {
    expect(problemOf(`a${c}b`)).toBe("invalid_char");
  });

  it("counts UTF-8 bytes, not characters (a 201-byte CJK name is too long)", () => {
    const ok = "漢".repeat(66); // 198 bytes
    const tooLong = "漢".repeat(67); // 201 bytes
    expect(byteLength(tooLong)).toBe(201);
    expect(problemOf(ok)).toBe("ok");
    expect(problemOf(tooLong)).toBe("too_long");
  });

  it("returns the normalized name: NFC, collapsed whitespace, one .md stripped for notes", () => {
    expect(validateName(`Cafe${COMBINING_ACUTE}`, "note")).toEqual({ ok: true, name: "Café" });
    expect(validateName("  a \t  b  ", "note")).toEqual({ ok: true, name: "a b" });
    expect(validateName("Plan.md", "note")).toEqual({ ok: true, name: "Plan" });
    expect(validateName("Plan.MD", "note")).toEqual({ ok: true, name: "Plan" });
    expect(validateName("a.md.md", "note")).toEqual({ ok: true, name: "a.md" });
    expect(validateName("Plan.md", "folder")).toEqual({ ok: true, name: "Plan.md" });
  });

  it("gives a human message for every failure", () => {
    const check = validateName("a/b", "folder");
    expect(check.ok).toBe(false);
    if (!check.ok) expect(check.message).toMatch(/can't contain/);
  });
});

describe("normalizeName", () => {
  it("treats NFD and NFC input as the same name", () => {
    expect(normalizeName(`Cafe${COMBINING_ACUTE}`, "folder")).toBe(normalizeName("Café", "folder"));
  });
});

describe("isSafeSegment", () => {
  it.each(["", ".", "..", ".trash", ".hidden", "a/b", "a\\b", `a${NUL}b`, "a".repeat(256)])(
    "rejects %j",
    (s) => expect(isSafeSegment(s)).toBe(false),
  );

  it("accepts odd-but-harmless names created by other tools", () => {
    expect(isSafeSegment("a:b")).toBe(true);
    expect(isSafeSegment("CON")).toBe(true);
    expect(isSafeSegment("name.")).toBe(true);
  });
});

describe("nameKey and uniqueName", () => {
  it("collides case- and normalization-insensitively", () => {
    expect(nameKey("Café")).toBe(nameKey(`CAFE${COMBINING_ACUTE}`));
  });

  it("returns the base when free", () => {
    expect(uniqueName("Untitled", ["Other"])).toBe("Untitled");
  });

  it("suffixes case-insensitively", () => {
    expect(uniqueName("Untitled", ["untitled"])).toBe("Untitled 2");
    expect(uniqueName("Untitled", ["UNTITLED", "untitled 2"])).toBe("Untitled 3");
  });
});

describe("compareNames", () => {
  it("sorts naturally and case-insensitively", () => {
    expect(["Note 10", "note 2", "Note 1", "apple"].sort(compareNames)).toEqual([
      "apple",
      "Note 1",
      "note 2",
      "Note 10",
    ]);
  });

  it("is deterministic for names that differ only in case", () => {
    expect(["b", "B"].sort(compareNames)).toEqual(["B", "b"]);
  });
});

describe("toSafeName", () => {
  it.each<[string, NameKind, string]>([
    ["Meeting notes.md", "note", "Meeting notes"],
    ["a/b:c", "note", "a-b-c"],
    [".bashrc", "note", "bashrc"],
    ["...", "note", UNTITLED],
    ["", "folder", UNTITLED],
    ["name. ", "note", "name"],
    ["CON", "note", "CON_"],
    ["con.txt", "folder", "con_.txt"],
    [`evil${RLO}gpj.exe`, "note", "evil-gpj.exe"],
  ])("%j (%s) → %j", (input, kind, expected) => {
    expect(toSafeName(input, kind)).toBe(expected);
  });

  it("truncates long names on a code point boundary", () => {
    const name = toSafeName("😀".repeat(100), "note"); // 400 bytes
    expect(byteLength(name)).toBeLessThanOrEqual(MAX_NAME_BYTES);
    expect(name).toBe("😀".repeat(50));
  });

  it("always produces a name validateName accepts (fuzz)", () => {
    // Small seeded PRNG so failures are reproducible.
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pieces = [
      "a",
      "Z",
      " ",
      ".",
      "..",
      ".md",
      ".MD",
      "/",
      "\\",
      ":",
      "*",
      "?",
      '"',
      "<",
      ">",
      "|",
      NUL,
      BELL,
      ch(0x1f),
      ch(0x7f),
      ch(0x9f),
      ZWSP,
      RLO,
      ch(0x2066),
      ch(0xfeff),
      "\t",
      "\n",
      "CON",
      "lpt1",
      "com¹",
      "😀",
      "漢".repeat(100),
      COMBINING_ACUTE,
      "e",
      "-",
    ];
    for (let i = 0; i < 500; i++) {
      let input = "";
      const length = Math.floor(random() * 12);
      for (let j = 0; j < length; j++) input += pieces[Math.floor(random() * pieces.length)];
      for (const kind of ["note", "folder"] as const) {
        const name = toSafeName(input, kind);
        const check = validateName(name, kind);
        expect(check, JSON.stringify({ input, kind, name })).toEqual({ ok: true, name });
      }
    }
  });
});
