import { afterEach, describe, expect, it } from "vitest";
import { resetProposalBases } from "@/lib/server/proposal-bases";
import { createFolder, createIntegration, createNote, saveNote } from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as mcp from "./agent/mcp/route";

/** The MCP endpoint, legacy and modern clients alike (docs/design-decisions.md#d31). */

type Rpc = {
  jsonrpc: "2.0";
  id: number | null;
  result?: Record<string, unknown>;
  error?: { code: number; message: string; data?: unknown };
};
type ToolResult = {
  content: { text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const MODERN = "2026-07-28";
const META = {
  "io.modelcontextprotocol/protocolVersion": MODERN,
  "io.modelcontextprotocol/clientCapabilities": {},
};

async function setUp() {
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ folder: "Essays", name: "Draft", content: "Intro.\n\n## A\n\nAlpha.\n" });
  await createNote({ folder: "Journal", name: "Private", content: "secret\n" });
  const { token } = await createIntegration({ name: "Hermes", kind: "hermes", folders: ["Essays"] });
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    mcp.POST(
      new Request("http://localhost/api/agent/mcp", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...headers },
        body: typeof body === "string" ? body : JSON.stringify(body),
      }),
    );
  /** A legacy (2025-06-18) request after initialize. */
  const legacy = async (id: number, method: string, params: object = {}) =>
    (await (
      await post({ jsonrpc: "2.0", id, method, params }, { "mcp-protocol-version": "2025-06-18" })
    ).json()) as Rpc;
  /** A modern request with the headers the 2026-07-28 binding requires. */
  const modern = (
    id: number,
    method: string,
    params: Record<string, unknown> = {},
    headers: Record<string, string> = {},
  ) =>
    post(
      { jsonrpc: "2.0", id, method, params: { ...params, _meta: META } },
      {
        "mcp-protocol-version": MODERN,
        "mcp-method": method,
        ...(typeof params.name === "string" ? { "mcp-name": params.name } : {}),
        ...headers,
      },
    );
  const call = async (name: string, args: object) =>
    (await legacy(9, "tools/call", { name, arguments: args })).result as unknown as ToolResult;
  return { post, legacy, modern, call };
}

afterEach(() => resetProposalBases());

describe("MCP, legacy clients", () => {
  it("answers initialize without a session, and a notification with 202", () =>
    withTempDataDir(async () => {
      const { post } = await setUp();
      const res = await post({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18" },
      });
      expect(res.headers.get("mcp-session-id")).toBeNull();
      const { result } = (await res.json()) as Rpc;
      expect(result).toMatchObject({
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "write" },
        instructions: expect.stringContaining("propose_changes"),
      });
      expect(result).not.toHaveProperty("resultType");
      const old = await post({
        jsonrpc: "2.0",
        id: 2,
        method: "initialize",
        params: { protocolVersion: "1999-01-01" },
      });
      expect(((await old.json()) as Rpc).result?.protocolVersion).toBe("2025-11-25");
      expect((await post({ jsonrpc: "2.0", method: "notifications/initialized" })).status).toBe(202);
    }));

  it("lists the tools and runs read, propose and get against the integration's folders", () =>
    withTempDataDir(async () => {
      const { legacy, call } = await setUp();
      const tools = (await legacy(2, "tools/list")).result?.tools as { name: string }[];
      expect(tools.map((t) => t.name)).toEqual([
        "list_notes",
        "read_note",
        "propose_changes",
        "get_proposal",
      ]);

      const listed = await call("list_notes", {});
      expect(listed.content[0].text).toContain("Essays/");
      expect(listed.content[0].text).not.toContain("Journal");

      const read = await call("read_note", { folder: "Essays", name: "Draft" });
      const version = read.structuredContent?.version as string;
      expect(read.content[0].text).toMatch(/^Version: [0-9a-f]{16}\nSections: ## A\n\nIntro\./);

      const proposed = await call("propose_changes", {
        folder: "Essays",
        name: "Draft",
        baseVersion: version,
        sections: [{ heading: "A", content: "## A\n\nAlpha, better.\n" }],
        requestId: "run-7",
      });
      expect(proposed.isError).toBeUndefined();
      expect(proposed.content[0].text).toContain("1 change(s) wait for the owner's review");
      const id = proposed.structuredContent?.id as string;
      const checked = await call("get_proposal", { id });
      expect(checked.structuredContent).toMatchObject({ id, status: "pending", waiting: 1 });
    }));

  it("reports what the model can fix as tool errors", () =>
    withTempDataDir(async () => {
      const { legacy, call } = await setUp();
      const hidden = await call("read_note", { folder: "Journal", name: "Private" });
      expect(hidden).toMatchObject({ isError: true, content: [{ text: "Note not found." }] });
      const bad = await call("propose_changes", {
        folder: "Essays",
        name: "Draft",
        baseVersion: "nope",
        content: "x",
      });
      expect(bad.isError).toBe(true);

      const read = await call("read_note", { folder: "Essays", name: "Draft" });
      const version = read.structuredContent?.version as string;
      await saveNote({
        ref: { folder: "Essays", name: "Draft" },
        content: "Changed.\n",
        baseVersion: version,
      });
      resetProposalBases();
      const stale = await call("propose_changes", {
        folder: "Essays",
        name: "Draft",
        baseVersion: version,
        content: "x\n",
      });
      expect(stale.isError).toBe(true);
      expect(stale.content[0].text).toMatch(/Read the note again.*now at version [0-9a-f]{16}/);

      const unknown = await legacy(3, "tools/call", { name: "delete_everything", arguments: {} });
      expect(unknown.error?.code).toBe(-32602);
      expect((await legacy(4, "resources/list")).error?.code).toBe(-32601);
    }));

  it("answers a batch, skipping notifications", () =>
    withTempDataDir(async () => {
      const { post } = await setUp();
      const res = await post([
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { jsonrpc: "2.0", method: "notifications/initialized" },
      ]);
      expect(await res.json()).toEqual([{ jsonrpc: "2.0", id: 1, result: {} }]);
    }));
});

describe("MCP, modern clients (2026-07-28)", () => {
  it("serves discover and tools with resultType and serverInfo", () =>
    withTempDataDir(async () => {
      const { modern } = await setUp();
      const discover = (await (await modern(1, "server/discover")).json()) as Rpc;
      expect(discover.result).toMatchObject({
        resultType: "complete",
        supportedVersions: expect.arrayContaining([MODERN, "2025-11-25"]),
        _meta: { "io.modelcontextprotocol/serverInfo": { name: "write" } },
      });
      const called = await modern(2, "tools/call", { name: "list_notes", arguments: {} });
      expect(called.status).toBe(200);
      expect(((await called.json()) as Rpc).result).toMatchObject({
        resultType: "complete",
        content: [{ type: "text" }],
      });
    }));

  it("checks the mirrored headers against the body", () =>
    withTempDataDir(async () => {
      const { modern, post } = await setUp();
      const wrongName = await modern(
        1,
        "tools/call",
        { name: "list_notes", arguments: {} },
        { "mcp-name": "read_note" },
      );
      expect(wrongName.status).toBe(400);
      expect(((await wrongName.json()) as Rpc).error?.code).toBe(-32020);
      const encoded = `=?base64?${Buffer.from("list_notes").toString("base64")}?=`;
      expect(
        (await modern(2, "tools/call", { name: "list_notes", arguments: {} }, { "mcp-name": encoded }))
          .status,
      ).toBe(200);
      const noMethod = await post(
        { jsonrpc: "2.0", id: 3, method: "tools/list", params: { _meta: META } },
        { "mcp-protocol-version": MODERN },
      );
      expect(((await noMethod.json()) as Rpc).error?.code).toBe(-32020);
    }));

  it("refuses unknown versions with the supported list, and unknown methods with 404", () =>
    withTempDataDir(async () => {
      const { post, modern } = await setUp();
      const future = { ...META, "io.modelcontextprotocol/protocolVersion": "2099-01-01" };
      const res = await post(
        { jsonrpc: "2.0", id: 1, method: "tools/list", params: { _meta: future } },
        { "mcp-protocol-version": "2099-01-01", "mcp-method": "tools/list" },
      );
      expect(res.status).toBe(400);
      expect(((await res.json()) as Rpc).error).toMatchObject({
        code: -32022,
        data: { requested: "2099-01-01" },
      });
      const missing = await modern(2, "subscriptions/listen");
      expect(missing.status).toBe(404);
      expect(((await missing.json()) as Rpc).error?.code).toBe(-32601);
    }));
});

describe("MCP over HTTP", () => {
  it("needs the token, refuses other sites, and answers GET with a JSON 405", () =>
    withTempDataDir(async () => {
      const { post } = await setUp();
      const anonymous = await mcp.POST(
        new Request("http://localhost/api/agent/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: "{}",
        }),
      );
      expect(anonymous.status).toBe(401);
      const foreign = await post(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { origin: "https://evil.example", host: "localhost" },
      );
      expect(foreign.status).toBe(403);
      const same = await post(
        { jsonrpc: "2.0", id: 1, method: "ping" },
        { origin: "http://localhost", host: "localhost" },
      );
      expect(same.status).toBe(200);
      expect((await post("{not json")).status).toBe(400);
      const get = await mcp.GET();
      expect(get.status).toBe(405);
      expect(get.headers.get("content-type")).toContain("application/json");
    }));
});
