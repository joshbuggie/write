import { describe, expect, it } from "vitest";
import { attachment } from "./content-disposition";

describe("attachment", () => {
  it("passes plain ASCII names through", () => {
    expect(attachment("notes.zip")).toBe(`attachment; filename="notes.zip"; filename*=UTF-8''notes.zip`);
  });

  it("strips accents for the ASCII fallback and keeps UTF-8 in filename*", () => {
    expect(attachment("Café.md")).toBe(`attachment; filename="Cafe.md"; filename*=UTF-8''Caf%C3%A9.md`);
  });

  it("replaces non-Latin characters, quotes and backslashes in the fallback", () => {
    const header = attachment('日記 "a\\b".md');
    expect(header).toContain(`filename="__ _a_b_.md"`);
    expect(header).toContain(`filename*=UTF-8''%E6%97%A5%E8%A8%98%20%22a%5Cb%22.md`);
  });

  it("percent-encodes the RFC 5987 extras that encodeURIComponent leaves alone", () => {
    expect(attachment("it's (1)*.md")).toContain(`filename*=UTF-8''it%27s%20%281%29%2A.md`);
  });

  it("produces a Latin-1-only header value", () => {
    const header = attachment("📝 Q&A — ünïcode.md");
    expect(/^[\x20-\x7e]*$/.test(header)).toBe(true);
    expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  });
});
