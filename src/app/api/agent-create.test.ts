import { afterEach, describe, expect, it } from "vitest";
import type { AgentCreateNoteResponse } from "@/lib/api-contract";
import { resetProposalBases } from "@/lib/server/proposal-bases";
import {
  createdRecordFor,
  createFolder,
  createIntegration,
  createNote,
  dismissCreatedRecord,
  listTree,
  readNote,
  saveNote,
  updateNote,
} from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as mcp from "./agent/mcp/route";
import * as notes from "./agent/notes/route";

/** Integrations creating notes (docs/design-decisions.md#d31), over MCP and REST. */

type ToolResult = {
  content: { text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

async function setUp(canCreate: boolean) {
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ folder: "Essays", name: "Draft", content: "Mine.\n" });
  const { token } = await createIntegration({
    name: "Hermes",
    kind: "hermes",
    folders: ["Essays"],
    canCreate,
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const rpc = async (method: string, params: object) => {
    const res = await mcp.POST(
      new Request("http://localhost/api/agent/mcp", {
        method: "POST",
        headers: { ...headers, "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      }),
    );
    return ((await res.json()) as { result: Record<string, unknown> }).result;
  };
  const tools = async () => ((await rpc("tools/list", {})).tools as { name: string }[]).map((t) => t.name);
  const call = async (name: string, args: object) =>
    (await rpc("tools/call", { name, arguments: args })) as unknown as ToolResult;
  const rest = (body: object) =>
    notes.POST(
      new Request("http://localhost/api/agent/notes", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  return { tools, call, rest };
}

const essayNames = async () =>
  (await listTree()).folders.find((f) => f.name === "Essays")?.notes.map((n) => n.name);

afterEach(() => resetProposalBases());

describe("creating notes as an integration", () => {
  it("offers create_note only to an integration allowed to create notes", () =>
    withTempDataDir(async () => {
      const { tools, call, rest } = await setUp(false);
      expect(await tools()).not.toContain("create_note");
      const refused = await call("create_note", { folder: "Essays", name: "New", content: "Hi.\n" });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("can't create notes");
      expect((await rest({ folder: "Essays", name: "New", content: "Hi.\n" })).status).toBe(403);
      expect(await essayNames()).toEqual(["Draft"]);
    }));

  it("writes the note at once, says who made it, and answers a retry with the same note", () =>
    withTempDataDir(async () => {
      const { tools, call } = await setUp(true);
      expect(await tools()).toContain("create_note");
      const args = {
        folder: "Essays",
        name: "Rock pools",
        content: "# Rock pools\n\nCold.\n",
        requestId: "r-1",
      };
      const made = await call("create_note", args);
      expect(made.isError).toBeUndefined();
      expect(made.content[0].text).toMatch(/^Created Essays\/Rock pools, version [0-9a-f]{16}\.$/);
      const note = await readNote({ folder: "Essays", name: "Rock pools" });
      expect(note.content).toBe("# Rock pools\n\nCold.\n");
      expect(made.structuredContent?.version).toBe(note.version);
      expect(await createdRecordFor(note)).toMatchObject({ source: "Hermes", requestId: "r-1" });

      const again = await call("create_note", args);
      expect(again.content[0].text).toContain("You sent this before");
      expect(await essayNames()).toEqual(["Draft", "Rock pools"]);
    }));

  it("never replaces a note, and can't reach a folder it can't read", () =>
    withTempDataDir(async () => {
      const { call, rest } = await setUp(true);
      const taken = await call("create_note", { folder: "Essays", name: "draft", content: "Theirs.\n" });
      expect(taken.isError).toBe(true);
      expect(taken.content[0].text).toContain('A note named "draft" already exists');
      expect((await readNote({ folder: "Essays", name: "Draft" })).content).toBe("Mine.\n");
      expect(await essayNames()).toEqual(["Draft"]);

      const hidden = await rest({ folder: "Journal", name: "Sneaky", content: "x\n" });
      expect(hidden.status).toBe(404);
      expect((await listTree()).folders.find((f) => f.name === "Journal")?.notes).toEqual([]);
    }));

  it("answers REST with 201, then 200 for the same request", () =>
    withTempDataDir(async () => {
      const { rest } = await setUp(true);
      const body = { folder: "Essays", name: "Plan", content: "## Plan\n", requestId: "job-2" };
      const first = await rest(body);
      expect(first.status).toBe(201);
      const { note } = (await first.json()) as AgentCreateNoteResponse;
      expect(note).toMatchObject({ folder: "Essays", name: "Plan" });
      const second = await rest(body);
      expect(second.status).toBe(200);
      expect(((await second.json()) as AgentCreateNoteResponse).note.version).toBe(note.version);
      expect((await rest({ ...body, requestId: "job-3" })).status).toBe(409);
    }));
});

describe("retrying a create", () => {
  const args = { folder: "Essays", name: "Rock pools", content: "Cold.\n", requestId: "create-1" };
  const note = { folder: "Essays", name: "Rock pools" };

  it("tells nothing about a note the owner moved out of reach, and creates nothing", () =>
    withTempDataDir(async () => {
      const { call, rest } = await setUp(true);
      await call("create_note", args);
      await updateNote({ ref: note, newFolder: "Journal" });
      const moved = { folder: "Journal", name: "Rock pools" };
      const current = await readNote(moved);
      await saveNote({ ref: moved, content: "Owner's private text.\n", baseVersion: current.version });

      const viaMcp = await call("create_note", args);
      expect(viaMcp.isError).toBe(true);
      expect(JSON.stringify(viaMcp)).not.toMatch(/private|Journal/i);
      const viaRest = await rest(args);
      expect(viaRest.status).toBe(404);
      expect(await viaRest.text()).not.toMatch(/private|Journal/i);
      // Naming another folder it can read doesn't get around it either.
      expect((await rest({ ...args, folder: "Essays", name: "Other" })).status).toBe(404);
      expect(await essayNames()).toEqual(["Draft"]);
    }));

  it("still returns the note after the owner dismissed who made it, even renamed", () =>
    withTempDataDir(async () => {
      const { call, rest } = await setUp(true);
      await call("create_note", args);
      await dismissCreatedRecord((await createdRecordFor(note))!.id);
      expect((await rest(args)).status).toBe(200);
      expect(await createdRecordFor(note)).toBeNull(); // the line stays hidden

      await updateNote({ ref: note, newName: "Tide pools" });
      const again = await call("create_note", args);
      expect(again.content[0].text).toContain("Essays/Tide pools");
      expect(await essayNames()).toEqual(["Draft", "Tide pools"]);
    }));
});
