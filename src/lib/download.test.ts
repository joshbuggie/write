import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isApiError } from "./api-client";
import { downloadFile, filenameFromDisposition } from "./download";

/** Minimal stand-in for the one DOM API downloadFile touches: a hidden <a download> appended to <body>. */
function fakeDocument() {
  const clicks: { href: string; download: string }[] = [];
  const anchor = {
    href: "",
    download: "",
    hidden: false,
    click: () => clicks.push({ href: anchor.href, download: anchor.download }),
    remove: vi.fn(),
  };
  return { clicks, doc: { createElement: () => anchor, body: { append: vi.fn() } } };
}

describe("filenameFromDisposition", () => {
  it("prefers the exact UTF-8 filename*", () => {
    expect(
      filenameFromDisposition(
        `attachment; filename="Cafe _.md"; filename*=UTF-8''Caf%C3%A9%20%F0%9F%93%9D.md`,
      ),
    ).toBe("Café 📝.md");
  });

  it("falls back to the quoted or bare filename", () => {
    expect(filenameFromDisposition('attachment; filename="Plan \\"B\\".md"')).toBe('Plan "B".md');
    expect(filenameFromDisposition("attachment; filename=notes.zip")).toBe("notes.zip");
    expect(filenameFromDisposition(`attachment; filename="a.md"; filename*=UTF-8''%E0%A4%A`)).toBe("a.md");
  });

  it("returns null without a name", () => {
    expect(filenameFromDisposition(null)).toBeNull();
    expect(filenameFromDisposition("attachment")).toBeNull();
  });
});

describe("downloadFile", () => {
  let dom: ReturnType<typeof fakeDocument>;

  beforeEach(() => {
    vi.useFakeTimers();
    dom = fakeDocument();
    vi.stubGlobal("document", dom.doc);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("saves a successful response under the server's file name, then revokes the URL", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("# Hi", {
            headers: { "Content-Disposition": `attachment; filename="x.md"; filename*=UTF-8''Caf%C3%A9.md` },
          }),
      ),
    );

    await downloadFile("/api/download?folder=a&name=Caf%C3%A9");

    expect(fetch).toHaveBeenCalledWith(
      "/api/download?folder=a&name=Caf%C3%A9",
      expect.objectContaining({ credentials: "same-origin" }),
    );
    expect(dom.clicks).toEqual([{ href: expect.stringMatching(/^blob:/), download: "Café.md" }]);
    expect(revoke).not.toHaveBeenCalled(); // the browser may still be reading it
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith(dom.clicks[0].href);
  });

  it("rejects with the server's ApiError and saves nothing on an error response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "not_found", message: "Note not found." } }, { status: 404 }),
      ),
    );

    const err = await downloadFile("/api/download?folder=a&name=b").catch((e: unknown) => e);

    expect(isApiError(err, "not_found")).toBe(true);
    expect((err as Error).message).toBe("Note not found.");
    expect(dom.clicks).toEqual([]);
  });

  it("maps a non-JSON error by status and a failed request to a network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>", { status: 401 })),
    );
    expect(isApiError(await downloadFile("/x").catch((e: unknown) => e), "unauthorized")).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 429 })),
    );
    expect(isApiError(await downloadFile("/x").catch((e: unknown) => e), "rate_limited")).toBe(true);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("Failed to fetch"))),
    );
    expect(isApiError(await downloadFile("/x").catch((e: unknown) => e), "network")).toBe(true);
    expect(dom.clicks).toEqual([]);
  });
});
