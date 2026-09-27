import { afterEach, describe, expect, it } from "vitest";
import type { ApiErrorBody } from "@/lib/api-contract";
import { resetProposalBases } from "@/lib/server/proposal-bases";
import {
  createFolder,
  createIntegration,
  createNote,
  listTree,
  readNote,
  updateProposal,
} from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as mcp from "./agent/mcp/route";
import * as notes from "./agent/notes/route";

/**
 * A harness that wraps a note in --- lines makes it front matter (docs/design-decisions.md#d31): writes that
 * are only front matter are refused, create_note says what it parsed, and a proposal says when the front
 * matter it sent isn't kept.
 */

type ToolResult = {
  content: { text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

const STORY = "# Natasha\n\n## Chapter One\n\nShe left at dawn.\n";
const FENCED = `---\n${STORY}---\n`;

async function setUp() {
  await createFolder("books");
  const { token } = await createIntegration({
    name: "Turnstone",
    kind: "turnstone",
    folders: ["books"],
    canCreate: true,
  });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const call = async (name: string, args: object) => {
    const res = await mcp.POST(
      new Request("http://localhost/api/agent/mcp", {
        method: "POST",
        headers: { ...headers, "mcp-protocol-version": "2025-06-18" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name, arguments: args },
        }),
      }),
    );
    return ((await res.json()) as { result: ToolResult }).result;
  };
  const rest = (body: object) =>
    notes.POST(
      new Request("http://localhost/api/agent/notes", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      }),
    );
  return { call, rest };
}

const bookNames = async () => (await listTree()).folders.find((f) => f.name === "books")?.notes ?? [];

afterEach(() => resetProposalBases());

describe("front matter from a harness", () => {
  it("refuses to create a note that is only front matter, over MCP and REST", () =>
    withTempDataDir(async () => {
      const { call, rest } = await setUp();
      const refused = await call("create_note", { folder: "books", name: "Natasha", content: FENCED });
      expect(refused.isError).toBe(true);
      expect(refused.content[0].text).toContain("Nothing was written: this content is only front matter");
      const viaRest = await rest({ folder: "books", name: "Natasha", content: `﻿${FENCED}` });
      expect(viaRest.status).toBe(400);
      expect(((await viaRest.json()) as ApiErrorBody).error.message).toContain("without a leading ---");
      const lone = await call("create_note", {
        folder: "books",
        name: "Natasha",
        content: FENCED.replace(/\n/g, "\r"),
      });
      expect(lone.isError).toBe(true);
      expect(await bookNames()).toEqual([]);
    }));

  it("creates a note with real front matter and text, and says what it parsed", () =>
    withTempDataDir(async () => {
      const { call } = await setUp();
      const made = await call("create_note", {
        folder: "books",
        name: "Natasha",
        content: `---\ntags: [draft]\n---\n${STORY}`,
      });
      expect(made.isError).toBeUndefined();
      expect(made.content[0].text).toContain("\nSections: # Natasha | ## Chapter One\n");
      expect(made.content[0].text).toContain("Front matter: 22 bytes");
      expect(made.structuredContent).toMatchObject({
        sections: ["# Natasha", "## Chapter One"],
        frontmatterBytes: 22,
      });
    }));

  it("tells a harness resending a story the note holds as front matter that it stays", () =>
    withTempDataDir(async () => {
      const { call } = await setUp();
      await createNote({ folder: "books", name: "Natasha", content: FENCED }); // made before the refusal
      const read = await call("read_note", { folder: "books", name: "Natasha" });
      expect(read.content[0].text).toContain("Sections: (no # or ## headings)");
      const baseVersion = read.structuredContent?.version as string;

      const proposed = await call("propose_changes", {
        folder: "books",
        name: "Natasha",
        baseVersion,
        content: STORY,
      });
      expect(proposed.isError).toBeUndefined();
      expect(proposed.content[0].text).toContain(
        `The note keeps its own front matter (${Buffer.byteLength(FENCED)} bytes`,
      );
      expect(proposed.content[0].text).toContain("ask the owner to remove it there");
      expect(proposed.structuredContent?.notice).toContain("in source mode");

      const same = await call("propose_changes", {
        folder: "books",
        name: "Natasha",
        baseVersion,
        content: `---\n${STORY}---\n`.replace("dawn", "dusk"),
      });
      expect(same.isError).toBe(true);
      expect(same.content[0].text).toContain("Nothing was proposed: this content is only front matter");
    }));

  it("refuses a whole-note proposal that is only front matter, and notes front matter it drops", () =>
    withTempDataDir(async () => {
      const { call } = await setUp();
      await createNote({ folder: "books", name: "Natasha", content: STORY });
      const read = await call("read_note", { folder: "books", name: "Natasha" });
      const baseVersion = read.structuredContent?.version as string;
      const propose = (content: string) =>
        call("propose_changes", { folder: "books", name: "Natasha", baseVersion, content });

      const fenced = await propose(FENCED.replace("dawn", "dusk"));
      expect(fenced.isError).toBe(true);
      expect(fenced.content[0].text).toContain("Nothing was proposed: this content is only front matter");

      const added = await propose(`---\ntags: [x]\n---\n${STORY.replace("dawn", "dusk")}`);
      expect(added.isError).toBeUndefined();
      expect(added.content[0].text).toContain("Your content starts with front matter");

      const unchanged = await propose(`---\ntags: [x]\n---\n${STORY}`);
      expect(unchanged.isError).toBe(true);
      expect(unchanged.content[0].text).toMatch(
        /doesn't change the note .* Your content starts with front matter/,
      );

      const plain = await propose(STORY.replace("dawn", "dusk."));
      expect(plain.isError).toBeUndefined();
      expect(plain.structuredContent).not.toHaveProperty("notice");
      expect((await readNote({ folder: "books", name: "Natasha" })).content).toBe(STORY);
    }));

  it("says it again on a retry whose first answer was lost, even after the owner decided", () =>
    withTempDataDir(async () => {
      const { call } = await setUp();
      await createNote({ folder: "books", name: "Natasha", content: `---\ntags: [a]\n---\n${STORY}` });
      const read = await call("read_note", { folder: "books", name: "Natasha" });
      const args = {
        folder: "books",
        name: "Natasha",
        baseVersion: read.structuredContent?.version as string,
        content: STORY.replace("dawn", "dusk"),
        requestId: "save-1",
      };
      const first = await call("propose_changes", args);
      expect(first.content[0].text).toContain("The note keeps its own front matter");

      const retry = await call("propose_changes", args);
      expect(retry.content[0].text).toContain("you sent this before");
      expect(retry.content[0].text).toContain("The note keeps its own front matter");
      expect(retry.structuredContent?.notice).toBe(first.structuredContent?.notice);

      await updateProposal(first.structuredContent?.id as string, (p) => ({ ...p, status: "dismissed" }));
      const late = await call("propose_changes", args);
      expect(late.structuredContent).toMatchObject({ status: "dismissed" });
      expect(late.structuredContent?.notice).toBe(first.structuredContent?.notice);
    }));
});
