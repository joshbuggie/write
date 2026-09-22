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
  ])("%j → %j", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
