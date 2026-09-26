import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { LauncherInput } from "@/lib/integrations";
import {
  createFolder,
  createIntegration,
  createNote,
  latestJob,
  mergeLauncher,
  updateIntegration,
  updateNote,
} from "../storage";
import { withTempDataDir } from "../storage/test-utils";
import { launch, testLauncher } from "./launch";

/** "Send to…" against a fake harness that records every request (docs/design-decisions.md#d31). */

type Seen = {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
};
let server: http.Server;
let seen: Seen[];
let reply: (s: Seen) => { status: number; body: unknown };
let base: string;

beforeEach(async () => {
  seen = [];
  reply = () => ({ status: 200, body: {} });
  server = http.createServer((req, res) => {
    let text = "";
    req.on("data", (c) => (text += c));
    req.on("end", () => {
      const s = {
        method: req.method ?? "",
        path: req.url ?? "",
        headers: req.headers,
        body: text ? JSON.parse(text) : {},
      };
      seen.push(s);
      const { status, body } = reply(s);
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterEach(() => new Promise<void>((resolve) => server.close(() => resolve())));

const launcher = (patch: Partial<LauncherInput> = {}): LauncherInput => ({
  url: base,
  key: "ts_secret_key_123456",
  ca: "",
  turnstoneMode: "workstream",
  mcpServerName: "write",
  ...patch,
});

async function setUp(
  kind: "turnstone" | "hermes" | "other",
  patch: Partial<LauncherInput> = {},
  canCreate = false,
) {
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ folder: "Essays", name: "Tides", content: "## A\n\nAlpha.\n" });
  await createNote({ folder: "Journal", name: "Private", content: "x\n" });
  const { integration } = await createIntegration({
    name: "Harness",
    kind,
    folders: ["Essays"],
    canCreate,
    launcher: launcher(patch),
  });
  const send = (fresh = false, name = "Tides") =>
    launch({
      integrationId: integration.id,
      folder: "Essays",
      name,
      instruction: "Tighten it.",
      sections: ["A"],
      fresh,
    });
  return { integration, send };
}

describe("launching jobs", () => {
  it("starts a Turnstone workstream with write's tools auto-approved, then continues it", () =>
    withTempDataDir(async () => {
      reply = (s) => ({
        status: 200,
        body: s.path.endsWith("/new") ? { ws_id: s.body.ws_id } : { status: "ok" },
      });
      const { send } = await setUp("turnstone");
      const first = await send();
      expect(seen[0]).toMatchObject({ method: "POST", path: "/v1/api/route/workstreams/new" });
      expect(seen[0].headers.authorization).toBe("Bearer ts_secret_key_123456");
      expect(seen[0].body).toMatchObject({ ws_id: first.id, name: "write: Tides" });
      expect(seen[0].body.auto_approve_tools).toEqual([
        "mcp__write__list_notes",
        "mcp__write__read_note",
        "mcp__write__propose_changes",
        "mcp__write__get_proposal",
      ]);
      expect(seen[0].body.initial_message).toContain(`requestId "${first.id}"`);
      expect(seen[0].body.initial_message).toContain('Change only these sections: "A"');

      const second = await send();
      expect(second.continued).toBe(true);
      expect(seen[1].path).toBe(`/v1/api/route/workstreams/${first.id}/send`);
      expect(seen[1].body.message).toContain("get_proposal");
    }));

  it("auto-approves create_note too when the integration may create notes", () =>
    withTempDataDir(async () => {
      reply = (s) => ({ status: 200, body: { ws_id: s.body.ws_id } });
      const { send } = await setUp("turnstone", { mcpServerName: "notes" }, true);
      await send();
      expect(seen[0].body.auto_approve_tools).toEqual([
        "mcp__notes__list_notes",
        "mcp__notes__read_note",
        "mcp__notes__propose_changes",
        "mcp__notes__get_proposal",
        "mcp__notes__create_note",
      ]);
    }));

  it("starts a coordinator, and starts over when the old one is gone", () =>
    withTempDataDir(async () => {
      reply = (s) =>
        s.path.endsWith("/send")
          ? { status: 404, body: { error: "Unknown workstream" } }
          : { status: 200, body: { ws_id: "c0ffee" } };
      const { send } = await setUp("turnstone", { turnstoneMode: "coordinator" });
      await send();
      expect(seen[0].path).toBe("/v1/api/workstreams/new");
      const again = await send();
      expect(seen.map((s) => s.path)).toEqual([
        "/v1/api/workstreams/new",
        "/v1/api/workstreams/c0ffee/send",
        "/v1/api/workstreams/new",
      ]);
      expect(again.continued).toBe(false);
    }));

  it("runs Hermes with the job as the idempotency key, and continues the same session", () =>
    withTempDataDir(async () => {
      reply = () => ({ status: 202, body: { run_id: "run_1", status: "started" } });
      const { send } = await setUp("hermes", { url: `${base}/p/testing` });
      const first = await send();
      expect(seen[0].path).toBe("/p/testing/v1/runs");
      expect(seen[0].headers["idempotency-key"]).toBe(first.id);
      expect(seen[0].body.session_id).toBe(`write-${first.id}`);
      await send();
      expect(seen[1].body.session_id).toBe(`write-${first.id}`);
    }));

  it("posts everything a webhook needs", () =>
    withTempDataDir(async () => {
      const { send } = await setUp("other", { key: "" });
      const job = await send();
      expect(seen[0].headers.authorization).toBeUndefined();
      expect(seen[0].body).toMatchObject({
        event: "write.send",
        jobId: job.id,
        previousJobId: null,
        note: { folder: "Essays", name: "Tides" },
        instruction: "Tighten it.",
      });
    }));

  it("says what went wrong: a refused key, a server that isn't there, a folder it can't read", () =>
    withTempDataDir(async () => {
      reply = () => ({ status: 401, body: { error: "Invalid credentials" } });
      const { send, integration } = await setUp("turnstone");
      await expect(send()).rejects.toMatchObject({
        code: "harness_error",
        message: expect.stringContaining("Check the key"),
      });
      await expect(
        launch({
          integrationId: integration.id,
          folder: "Journal",
          name: "Private",
          instruction: "",
          sections: [],
          fresh: true,
        }),
      ).rejects.toMatchObject({
        code: "bad_request",
        message: expect.stringContaining("can't read the folder"),
      });
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await expect(send()).rejects.toMatchObject({ code: "harness_unreachable" });
      server = http.createServer().listen(0); // for afterEach
    }));

  it("keeps a job with its note through a rename, so the conversation continues", () =>
    withTempDataDir(async () => {
      reply = (s) => ({ status: 200, body: { ws_id: s.body.ws_id ?? "x" } });
      const { send, integration } = await setUp("turnstone");
      const first = await send();
      await updateNote({ ref: { folder: "Essays", name: "Tides" }, newName: "Tide pools" });
      expect((await latestJob(integration.id, { folder: "Essays", name: "Tide pools" }))?.id).toBe(first.id);
      expect((await send(false, "Tide pools")).continued).toBe(true);
    }));
});

describe("launcher settings", () => {
  it("keeps the saved key only for the same server, and drops it when the address moves", () => {
    const saved = mergeLauncher(launcher(), null);
    expect(mergeLauncher(launcher({ key: undefined }), saved).key).toBe("ts_secret_key_123456");
    expect(mergeLauncher(launcher({ key: undefined, url: "http://elsewhere:1" }), saved).key).toBeNull();
    expect(mergeLauncher(launcher({ key: undefined, clearKey: true }), saved).key).toBeNull();
    expect(() => mergeLauncher(launcher({ ca: "not a pem" }), null)).toThrow(/PEM/);
  });

  it("tests Turnstone without starting anything, and names missing permissions", () =>
    withTempDataDir(async () => {
      reply = () => ({
        status: 200,
        body: { username: "bombo", permissions: "read,write,workstreams.create" },
      });
      const { integration } = await setUp("turnstone");
      const ok = await testLauncher({
        integrationId: integration.id,
        kind: "turnstone",
        launcher: launcher({ key: undefined }),
      });
      expect(ok).toBe("Signed in to Turnstone as bombo.");
      expect(seen[0].headers.authorization).toBe("Bearer ts_secret_key_123456"); // the saved key, same server
      const coordinator = await testLauncher({
        integrationId: null,
        kind: "turnstone",
        launcher: launcher({ turnstoneMode: "coordinator" }),
      });
      expect(coordinator).toContain("lacks admin.coordinator");
      await updateIntegration(integration.id, {
        name: "Harness",
        kind: "turnstone",
        folders: ["Essays"],
        launcher: null,
      });
    }));
});
