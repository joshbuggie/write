import { describe, expect, it } from "vitest";
import {
  apiQuery,
  decodeSegment,
  downloadFolderHref,
  downloadNoteHref,
  loginHref,
  noteHref,
  noteRefFromParams,
  safeNextPath,
} from "./routes";

const NAMES = ["100% done?", "Q&A + more", "a#b", "Café", "Notes 📝", "a/b", "plain"];

/** What Next 16 hands a page: the raw, still percent-encoded path segments. */
function pageParams(href: string) {
  const [, notes, folder, note] = href.split("/");
  expect(notes).toBe("notes");
  return { folder, note };
}

describe("noteHref + decodeSegment", () => {
  it.each(NAMES)("round-trips %j exactly once", (name) => {
    const ref = { folder: "Work", name };
    const params = pageParams(noteHref(ref));
    expect(noteRefFromParams(params)).toEqual(ref);
  });

  it("keeps each name in a single path segment", () => {
    expect(noteHref({ folder: "a/b", name: "c?d#e" })).toBe("/notes/a%2Fb/c%3Fd%23e");
  });

  it("returns malformed input unchanged instead of throwing", () => {
    expect(decodeSegment("100%")).toBe("100%");
    expect(decodeSegment("%E0%A4%A")).toBe("%E0%A4%A");
  });
});

describe("API hrefs", () => {
  it.each(NAMES)("puts %j in the query string, readable with URLSearchParams", (name) => {
    const url = new URL(downloadNoteHref({ folder: "Café", name }), "http://localhost");
    expect(url.pathname).toBe("/api/download");
    expect(url.searchParams.get("folder")).toBe("Café");
    expect(url.searchParams.get("name")).toBe(name);
  });

  it("builds folder downloads and skips undefined params", () => {
    expect(new URL(downloadFolderHref("Q&A"), "http://x").searchParams.get("folder")).toBe("Q&A");
    expect(apiQuery({ a: "1", b: undefined })).toBe("?a=1");
    expect(apiQuery({})).toBe("");
  });

  it("encodes the login redirect target", () => {
    expect(loginHref()).toBe("/login");
    expect(new URL(loginHref("/notes/a b?x=1"), "http://x").searchParams.get("next")).toBe("/notes/a b?x=1");
  });
});

describe("safeNextPath", () => {
  it.each([
    [null, "/"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["notes", "/"],
    ["/notes/Work/Plan", "/notes/Work/Plan"],
    // Browsers strip tab/CR/LF, so these would resolve to //evil.com.
    ["/\t/evil.com", "/"],
    ["/\n/evil.com", "/"],
    ["/\r//evil.com", "/"],
    ["/ /evil.com", "/"],
    ["/\\\\evil.com", "/"],
    ["/x\\evil.com", "/"],
    ["/\u0000/evil.com", "/"],
    ["https://evil.com", "/"],
    // Still-encoded characters are ordinary path characters.
    ["/%09/evil.com", "/%09/evil.com"],
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"],
    ["/notes/a%20b?x=1#h", "/notes/a%20b?x=1#h"],
    ["/notes/a/../b", "/notes/b"],
    // Dot segments are resolved by the parser; these must not collapse into a protocol-relative "//evil.com".
    ["/.//evil.com", "/"],
    ["/..//evil.com", "/"],
    ["/a/..//evil.com", "/"],
    ["/%2e//evil.com", "/"],
    ["/%2E%2E//evil.com", "/"],
    ["/x/%2e%2e//evil.com", "/"],
    ["/notes/%2e%2e/%2e%2e//evil.com", "/"],
    ["/./notes/Work", "/notes/Work"],
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
    expect(new URL(safeNextPath(input), "https://notes.example.com/login").origin).toBe(
      "https://notes.example.com",
    );
  });

  /** Tiny seeded PRNG so a failure prints a reproducible input. */
  function mulberry32(seed: number) {
    return () => {
      seed = (seed + 0x6d2b79f5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const PIECES = ["/", "//", ".", "..", "%2e", "%2E", "%2f", "\\", "\t", "a", "evil.com", "?", "#", ":", "@"];

  it("never returns a path that leaves the origin, for random combinations of tricky pieces", () => {
    const random = mulberry32(42);
    for (let i = 0; i < 5000; i++) {
      const length = 1 + Math.floor(random() * 8);
      const input = "/" + Array.from({ length }, () => PIECES[Math.floor(random() * PIECES.length)]).join("");
      const out = safeNextPath(input);
      expect(out, input).toMatch(/^\/(?![/\\])/);
      for (const base of ["https://notes.example.com/login", "https://notes.example.com/notes/a/b"]) {
        expect(new URL(out, base).origin, input).toBe("https://notes.example.com");
      }
      expect(safeNextPath(out), input).toBe(out);
    }
  });
});
