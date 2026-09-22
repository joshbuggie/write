import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ApiErrorBody,
  DiscardNoteResponse,
  FolderResponse,
  NoteResponse,
  SaveNoteResponse,
  TreeResponse,
  UpdateNoteResponse,
} from "@/lib/api-contract";
import { MAX_NOTE_BYTES } from "@/lib/constants";
import { resetLoginThrottle } from "@/lib/server/auth";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as login from "./auth/login/route";
import * as logout from "./auth/logout/route";
import * as download from "./download/route";
import * as folders from "./folders/route";
import * as health from "./health/route";
import * as notes from "./notes/route";
import * as tree from "./tree/route";

/**
 * Handler integration tests: real route exports + real storage, each test in its own temp data dir.
 * Routes are called directly with web Requests, exactly as Next calls them.
 */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;
type Init = { body?: unknown; headers?: Record<string, string> };

async function call(handler: Handler, method: string, url: string, init: Init = {}): Promise<Response> {
  const headers: Record<string, string> = { ...init.headers };
  if (init.body !== undefined) headers["content-type"] ??= "application/json";
  const body = init.body === undefined ? undefined : JSON.stringify(init.body);
  const res = await handler(new Request(`http://localhost${url}`, { method, body, headers }), {
    params: Promise.resolve({}),
  });
  expect(res.headers.get("cache-control")).toBe("no-store");
  return res;
}

const errorCode = async (res: Response) => ((await res.json()) as ApiErrorBody).error.code;
const bootstrap = () => call(tree.GET, "GET", "/api/tree");
async function createNote(body: { folder: string; name?: string; content?: string }) {
  const res = await call(notes.POST, "POST", "/api/notes", { body });
  expect(res.status).toBe(201);
  return ((await res.json()) as NoteResponse).note;
}
const q = (params: Record<string, string>) => "?" + new URLSearchParams(params).toString();

// Auth off unless a test turns it on, even if the developer shell exports WRITE_PASSWORD.
beforeEach(() => vi.stubEnv("WRITE_PASSWORD", ""));
afterEach(() => {
  vi.unstubAllEnvs();
  resetLoginThrottle();
});

describe("GET /api/health", () => {
  it("is 200 when the data dir is writable", () =>
    withTempDataDir(async () => {
      const res = await call(health.GET, "GET", "/api/health");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ ok: true });
    }));

  it("is 503 without leaking paths when storage is unusable", () =>
    withTempDataDir(async (dir) => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      process.env.WRITE_DATA_DIR = path.join(dir, ".next", "data"); // refused by storage config
      const res = await call(health.GET, "GET", "/api/health");
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ ok: false, error: "storage unavailable" });
    }));
});

describe("GET /api/tree", () => {
  it("bootstraps a fresh data dir with notebook/Welcome", () =>
    withTempDataDir(async () => {
      const res = await bootstrap();
      expect(res.status).toBe(200);
      const body = (await res.json()) as TreeResponse;
      expect(body.folders.map((f) => f.name)).toEqual(["notebook"]);
      expect(body.folders[0].notes.map((n) => n.name)).toEqual(["Welcome"]);
    }));
});

describe("/api/folders", () => {
  it("creates, rejects invalid and duplicate names", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const created = await call(folders.POST, "POST", "/api/folders", { body: { name: "Work" } });
      expect(created.status).toBe(201);
      expect(((await created.json()) as FolderResponse).folder).toEqual({ name: "Work", notes: [] });

      const invalid = await call(folders.POST, "POST", "/api/folders", { body: { name: "a/b" } });
      expect(invalid.status).toBe(400);
      expect(await errorCode(invalid)).toBe("invalid_name");

      const taken = await call(folders.POST, "POST", "/api/folders", { body: { name: "work" } });
      expect(taken.status).toBe(409);
      expect(await errorCode(taken)).toBe("name_taken");

      const badBody = await call(folders.POST, "POST", "/api/folders", { body: { nme: "x" } });
      expect(await errorCode(badBody)).toBe("bad_request");
    }));

  it("renames: 200, 404 missing, 409 taken", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await call(folders.POST, "POST", "/api/folders", { body: { name: "Work" } });
      const renamed = await call(folders.PATCH, "PATCH", "/api/folders", {
        body: { name: "Work", newName: "Projects" },
      });
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()) as FolderResponse).folder.name).toBe("Projects");

      const missing = await call(folders.PATCH, "PATCH", "/api/folders", {
        body: { name: "Nope", newName: "Other" },
      });
      expect(missing.status).toBe(404);

      const taken = await call(folders.PATCH, "PATCH", "/api/folders", {
        body: { name: "Projects", newName: "Notebook" },
      });
      expect(taken.status).toBe(409);
      expect(await errorCode(taken)).toBe("name_taken");
    }));

  it("deletes: 204, then 404; 400 without a name", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await call(folders.POST, "POST", "/api/folders", { body: { name: "Work" } });
      expect((await call(folders.DELETE, "DELETE", "/api/folders" + q({ name: "Work" }))).status).toBe(204);
      expect((await call(folders.DELETE, "DELETE", "/api/folders" + q({ name: "Work" }))).status).toBe(404);
      expect((await call(folders.DELETE, "DELETE", "/api/folders")).status).toBe(400);
      const listed = (await (await bootstrap()).json()) as TreeResponse;
      expect(listed.folders.map((f) => f.name)).toEqual(["notebook"]);
    }));
});

describe("/api/notes", () => {
  it("POST creates Untitled, auto-suffixes, validates names and folder", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const first = await call(notes.POST, "POST", "/api/notes", { body: { folder: "notebook" } });
      expect(first.status).toBe(201);
      const note = ((await first.json()) as NoteResponse).note;
      expect(note).toMatchObject({ folder: "notebook", name: "Untitled", content: "", readOnly: null });
      expect(note.version).toMatch(/^[0-9a-f]{16}$/);
      expect((await createNote({ folder: "notebook" })).name).toBe("Untitled 2");
      expect((await createNote({ folder: "notebook", name: "untitled" })).name).toBe("untitled 3");

      const invalid = await call(notes.POST, "POST", "/api/notes", {
        body: { folder: "notebook", name: "CON" },
      });
      expect(await errorCode(invalid)).toBe("invalid_name");
      const noFolder = await call(notes.POST, "POST", "/api/notes", { body: { folder: "Nope" } });
      expect(noFolder.status).toBe(404);
      const tooBig = await call(notes.POST, "POST", "/api/notes", {
        body: { folder: "notebook", content: "x".repeat(MAX_NOTE_BYTES + 1) },
      });
      expect(tooBig.status).toBe(413);
    }));

  it("GET reads a note by query params; 404 missing; 400 without params", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await createNote({ folder: "notebook", name: "Q&A + more #1", content: "# Hi\n" });
      const res = await call(
        notes.GET,
        "GET",
        "/api/notes" + q({ folder: "notebook", name: "Q&A + more #1" }),
      );
      expect(res.status).toBe(200);
      expect(((await res.json()) as NoteResponse).note).toMatchObject({
        name: "Q&A + more #1",
        content: "# Hi\n",
      });
      expect(
        (await call(notes.GET, "GET", "/api/notes" + q({ folder: "notebook", name: "Nope" }))).status,
      ).toBe(404);
      expect((await call(notes.GET, "GET", "/api/notes" + q({ folder: "notebook" }))).status).toBe(400);
    }));

  it("PUT saves, detects conflicts with current, handles missing files and size", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const note = await createNote({ folder: "notebook", name: "Plan", content: "v1\n" });
      const put = (body: Record<string, unknown>) =>
        call(notes.PUT, "PUT", "/api/notes", { body: { folder: "notebook", name: "Plan", ...body } });

      const saved = await put({ content: "v2\n", baseVersion: note.version });
      expect(saved.status).toBe(200);
      const savedNote = ((await saved.json()) as SaveNoteResponse).note;
      expect(savedNote.version).not.toBe(note.version);

      const stale = await put({ content: "v3\n", baseVersion: note.version });
      expect(stale.status).toBe(409);
      const conflict = (await stale.json()) as ApiErrorBody;
      expect(conflict.error.code).toBe("version_conflict");
      expect(conflict.current).toMatchObject({ content: "v2\n", version: savedNote.version });

      const forced = await put({ content: "v3\n", baseVersion: note.version, force: true });
      expect(forced.status).toBe(200);

      const noFolder = await call(notes.PUT, "PUT", "/api/notes", {
        body: { folder: "Nope", name: "Plan", content: "x", baseVersion: null },
      });
      expect(noFolder.status).toBe(404);

      const oversize = await put({ content: "x".repeat(MAX_NOTE_BYTES + 128 * 1024), baseVersion: null });
      expect(oversize.status).toBe(413);

      const badBody = await put({ content: 42, baseVersion: null });
      expect(badBody.status).toBe(400);
    }));

  it("PUT on a deleted note: conflict with current null, force re-creates", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const note = await createNote({ folder: "notebook", name: "Gone", content: "a\n" });
      await call(notes.DELETE, "DELETE", "/api/notes" + q({ folder: "notebook", name: "Gone" }));
      const body = { folder: "notebook", name: "Gone", content: "mine\n" };

      const res = await call(notes.PUT, "PUT", "/api/notes", {
        body: { ...body, baseVersion: note.version },
      });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ error: { code: "version_conflict" }, current: null });

      const recreated = await call(notes.PUT, "PUT", "/api/notes", {
        body: { ...body, baseVersion: null, force: true },
      });
      expect(recreated.status).toBe(200);
      const read = await call(notes.GET, "GET", "/api/notes" + q({ folder: "notebook", name: "Gone" }));
      expect(((await read.json()) as NoteResponse).note.content).toBe("mine\n");
    }));

  it("PATCH renames and moves; 404, 409 and 400 errors", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await call(folders.POST, "POST", "/api/folders", { body: { name: "Work" } });
      await createNote({ folder: "notebook", name: "Draft", content: "x\n" });
      await createNote({ folder: "notebook", name: "Taken" });
      const patch = (body: Record<string, unknown>) => call(notes.PATCH, "PATCH", "/api/notes", { body });

      const renamed = await patch({ folder: "notebook", name: "Draft", newName: "Final" });
      expect(renamed.status).toBe(200);
      expect(((await renamed.json()) as UpdateNoteResponse).note).toMatchObject({
        folder: "notebook",
        name: "Final",
      });

      const moved = await patch({ folder: "notebook", name: "Final", newFolder: "Work" });
      expect(((await moved.json()) as UpdateNoteResponse).note).toMatchObject({
        folder: "Work",
        name: "Final",
      });

      expect((await patch({ folder: "notebook", name: "Nope", newName: "X" })).status).toBe(404);
      expect((await patch({ folder: "notebook", name: "Taken", newFolder: "Nope" })).status).toBe(404);
      const taken = await patch({ folder: "Work", name: "Final", newName: "taken", newFolder: "notebook" });
      expect(taken.status).toBe(409);
      expect(await errorCode(taken)).toBe("name_taken");
      expect((await patch({ folder: "notebook", name: "Taken" })).status).toBe(400);
    }));

  it("DELETE moves to trash (204), then 404", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await createNote({ folder: "notebook", name: "Old", content: "bye\n" });
      const url = "/api/notes" + q({ folder: "notebook", name: "Old" });
      expect((await call(notes.DELETE, "DELETE", url)).status).toBe(204);
      expect((await call(notes.GET, "GET", url)).status).toBe(404);
      expect((await call(notes.DELETE, "DELETE", url)).status).toBe(404);
    }));

  it("DELETE ?ifEmpty=1 discards only blank notes and never 404s", () =>
    withTempDataDir(async () => {
      await bootstrap();
      await createNote({ folder: "notebook" });
      await createNote({ folder: "notebook", name: "Blank", content: "  \n\n" });
      await createNote({ folder: "notebook", name: "Kept", content: "text\n" });
      const discard = async (name: string) => {
        const res = await call(
          notes.DELETE,
          "DELETE",
          "/api/notes" + q({ folder: "notebook", name, ifEmpty: "1" }),
        );
        expect(res.status).toBe(200);
        return ((await res.json()) as DiscardNoteResponse).deleted;
      };
      expect(await discard("Untitled")).toBe(true);
      expect(await discard("Blank")).toBe(true);
      expect(await discard("Kept")).toBe(false);
      expect(await discard("Missing")).toBe(false);
      const kept = await call(notes.GET, "GET", "/api/notes" + q({ folder: "notebook", name: "Kept" }));
      expect(kept.status).toBe(200);
    }));
});

describe("GET /api/download", () => {
  const expectDownloadHeaders = (res: Response, type: string) => {
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(type);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; /);
  };

  it("returns the exact note bytes with a UTF-8 filename", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const content = "---\ntitle: x\n---\n\nCafé & <b>\n";
      await createNote({ folder: "notebook", name: "Café", content });
      const res = await call(download.GET, "GET", "/api/download" + q({ folder: "notebook", name: "Café" }));
      expectDownloadHeaders(res, "text/markdown; charset=utf-8");
      expect(res.headers.get("content-disposition")).toBe(
        `attachment; filename="Cafe.md"; filename*=UTF-8''Caf%C3%A9.md`,
      );
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(res.headers.get("content-length")).toBe(String(bytes.byteLength));
      expect(new TextDecoder().decode(bytes)).toBe(content);
    }));

  it("zips everything or one folder", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const all = await call(download.GET, "GET", "/api/download");
      expectDownloadHeaders(all, "application/zip");
      expect(all.headers.get("content-disposition")).toMatch(/filename="write-notes-\d{4}-\d{2}-\d{2}\.zip"/);
      const magic = new Uint8Array(await all.arrayBuffer()).slice(0, 2);
      expect(String.fromCharCode(...magic)).toBe("PK");

      const one = await call(download.GET, "GET", "/api/download" + q({ folder: "notebook" }));
      expectDownloadHeaders(one, "application/zip");
      expect(one.headers.get("content-disposition")).toContain(`filename="notebook.zip"`);
    }));

  it("404s for a missing folder or note; 400 for a name without a folder", () =>
    withTempDataDir(async () => {
      await bootstrap();
      expect((await call(download.GET, "GET", "/api/download" + q({ folder: "Nope" }))).status).toBe(404);
      const note = q({ folder: "notebook", name: "Nope" });
      expect((await call(download.GET, "GET", "/api/download" + note)).status).toBe(404);
      expect((await call(download.GET, "GET", "/api/download" + q({ name: "Welcome" }))).status).toBe(400);
    }));
});

describe("CSRF on real routes", () => {
  it("415 for a text/plain POST and 403 for a cross-site request", () =>
    withTempDataDir(async () => {
      await bootstrap();
      const plain = await call(folders.POST, "POST", "/api/folders", {
        body: { name: "Work" },
        headers: { "content-type": "text/plain" },
      });
      expect(plain.status).toBe(415);
      expect(await errorCode(plain)).toBe("unsupported_media_type");

      const crossSite = await call(
        notes.DELETE,
        "DELETE",
        "/api/notes" + q({ folder: "notebook", name: "Welcome" }),
        {
          headers: { "sec-fetch-site": "cross-site" },
        },
      );
      expect(crossSite.status).toBe(403);
      expect(await errorCode(crossSite)).toBe("forbidden");
    }));
});

describe("auth", () => {
  it("login is 400 when auth is disabled", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_PASSWORD", "");
      const res = await call(login.POST, "POST", "/api/auth/login", { body: { password: "x" } });
      expect(res.status).toBe(400);
    }));

  it("401 without credentials; 200 with Bearer; login cookie works; logout clears it", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const denied = await call(tree.GET, "GET", "/api/tree");
      expect(denied.status).toBe(401);
      expect(await errorCode(denied)).toBe("unauthorized");
      expect((await call(health.GET, "GET", "/api/health")).status).toBe(200);
      expect(
        (await call(tree.GET, "GET", "/api/tree", { headers: { authorization: "Bearer pw" } })).status,
      ).toBe(200);

      const signedIn = await call(login.POST, "POST", "/api/auth/login", { body: { password: "pw" } });
      expect(signedIn.status).toBe(204);
      const setCookie = signedIn.headers.get("set-cookie") ?? "";
      expect(setCookie).toMatch(
        /^write_session=v1\.\d+\.[\w-]+; HttpOnly; SameSite=Lax; Path=\/; Max-Age=2592000$/,
      );
      const cookie = setCookie.split(";")[0];
      expect((await call(tree.GET, "GET", "/api/tree", { headers: { cookie } })).status).toBe(200);

      const out = await call(logout.POST, "POST", "/api/auth/logout", { body: {}, headers: { cookie } });
      expect(out.status).toBe(204);
      expect(out.headers.get("set-cookie")).toContain("Max-Age=0");
      expect((await call(logout.POST, "POST", "/api/auth/logout", { body: {} })).status).toBe(401);
    }));

  it("sets Secure behind an https reverse proxy", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const res = await call(login.POST, "POST", "/api/auth/login", {
        body: { password: "pw" },
        headers: { "x-forwarded-proto": "https" },
      });
      expect(res.headers.get("set-cookie")).toMatch(/; Secure$/);
    }));

  it("wrong passwords get 401, then a throttle message after 5 failures", () =>
    withTempDataDir(async () => {
      vi.stubEnv("WRITE_PASSWORD", "pw");
      const attempt = async () => {
        const res = await call(login.POST, "POST", "/api/auth/login", { body: { password: "nope" } });
        expect(res.status).toBe(401);
        return ((await res.json()) as ApiErrorBody).error.message;
      };
      for (let i = 0; i < 4; i++) expect(await attempt()).toBe("Wrong password.");
      expect(await attempt()).toBe("Too many attempts — wait a moment.");
    }));
});
