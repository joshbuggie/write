import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentProposalResponse,
  ApiErrorBody,
  NoteResponse,
  ProposalsResponse,
  ResolveProposalResponse,
} from "@/lib/api-contract";
import { resetPasswordGuard } from "@/lib/server/auth";
import { sessionCookieFor, setUpTestAccount } from "@/lib/server/auth-test-utils";
import { resetProposalBases } from "@/lib/server/proposal-bases";
import {
  createFolder,
  createIntegration,
  createNote,
  deleteFolder,
  deleteNote,
  getProposal,
  readNote,
  renameFolder,
  saveNote,
  updateNote,
} from "@/lib/server/storage";
import { withTempDataDir } from "@/lib/server/storage/test-utils";
import * as agentNotes from "./agent/notes/route";
import * as agentProposals from "./agent/proposals/route";
import * as proposals from "./proposals/route";
import * as resolve from "./proposals/resolve/route";

/** Proposals from a harness to the owner's review, through the real route exports (docs/design-decisions.md#d31). */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;
function call(
  handler: Handler,
  method: string,
  url: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const h = { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) };
  const init = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) };
  return handler(new Request(`http://localhost${url}`, init), { params: Promise.resolve({}) });
}

const NOTE = "---\ntags: [draft]\n---\nIntro.\n\n## A\n\nAlpha.\n\n## B\n\nBeta.\n\n## C\n\nGamma.\n";
const ref = { folder: "Essays", name: "Draft" };

async function setUp() {
  const account = await setUpTestAccount("owner", "pw");
  const owner = { cookie: sessionCookieFor(account) };
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ ...ref, content: NOTE });
  await createNote({ folder: "Journal", name: "Private", content: "## A\n\nsecret\n" });
  const { token } = await createIntegration({ name: "Turnstone", kind: "turnstone", folders: ["Essays"] });
  const agent = { authorization: `Bearer ${token}` };
  const read = async (r = ref) =>
    (
      (await (
        await call(agentNotes.GET, "GET", `/api/agent/notes?folder=${r.folder}&name=${r.name}`, agent)
      ).json()) as NoteResponse
    ).note;
  const propose = (body: object) =>
    call(agentProposals.POST, "POST", "/api/agent/proposals", agent, { ...ref, ...body });
  const reviews = async () =>
    (
      (await (
        await call(proposals.GET, "GET", "/api/proposals?folder=Essays&name=Draft", owner)
      ).json()) as ProposalsResponse
    ).reviews;
  const decide = (body: object) => call(resolve.POST, "POST", "/api/proposals/resolve", owner, body);
  const status = async (id: string) =>
    (
      (await (
        await call(agentProposals.GET, "GET", `/api/agent/proposals?id=${id}`, agent)
      ).json()) as AgentProposalResponse
    ).proposal;
  return { owner, agent, read, propose, reviews, decide, status };
}

const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  vi.restoreAllMocks();
  resetPasswordGuard();
  resetProposalBases();
});

describe("proposals", () => {
  it("goes from a harness's full rewrite to the note, only with the owner's accept", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, decide, status } = await setUp();
      const note = await read();
      const res = await propose({
        baseVersion: note.version,
        content: note.content.replace("Alpha.", "Alpha, sharper.").replace("tags: [draft]", "tags: [x]"),
        summary: "Tightened A",
        reasons: { A: "clearer" },
      });
      expect(res.status).toBe(201);
      const { proposal } = (await res.json()) as AgentProposalResponse;
      expect(proposal).toMatchObject({ status: "pending", waiting: 1 });
      expect((await readNote(ref)).content).toBe(NOTE); // proposing never writes the note

      const [review] = await reviews();
      expect(review.changes.map((c) => [c.key, c.state, c.reason])).toEqual([["2:a", "clean", "clearer"]]);
      const done = await decide({
        id: review.id,
        noteVersion: review.noteVersion,
        accept: ["2:a"],
        reject: [],
      });
      const body = (await done.json()) as ResolveProposalResponse;
      expect(body.waiting).toBe(0);
      expect(body.previousContent).toBe(NOTE);
      expect((await readNote(ref)).content).toBe(NOTE.replace("Alpha.", "Alpha, sharper.")); // front matter kept
      expect(await status(proposal.id)).toMatchObject({
        status: "applied",
        waiting: 0,
        decisions: [{ key: "2:a", decision: "accepted" }],
      });
      expect(await reviews()).toEqual([]);
      const saved = await getProposal(proposal.id);
      expect([saved?.base, saved?.proposed]).toEqual(["", ""]); // closed: the text isn't kept
    }));

  it("keeps the owner's edits made while the harness worked, and flags the sections both changed", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, decide } = await setUp();
      const base = await read();
      await saveNote({ ref, content: NOTE.replace("Gamma.", "Gamma, mine."), baseVersion: base.version });
      await propose({
        baseVersion: base.version,
        sections: [
          { heading: "A", content: "## A\n\nAlpha, theirs.\n" },
          { heading: "## C", content: "## C\n\nGamma, theirs.\n" },
        ],
      });
      const [review] = await reviews();
      expect(review.changes.map((c) => [c.key, c.state])).toEqual([
        ["2:a", "clean"],
        ["2:c", "conflict"],
      ]);
      await decide({ id: review.id, noteVersion: review.noteVersion, accept: ["2:a"], reject: ["2:c"] });
      expect((await readNote(ref)).content).toBe(
        NOTE.replace("Alpha.", "Alpha, theirs.").replace("Gamma.", "Gamma, mine."),
      );
    }));

  it("leaves undecided changes waiting, and a rejection writes nothing", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, decide, status } = await setUp();
      const note = await read();
      const { proposal } = (await (
        await propose({
          baseVersion: note.version,
          content: note.content.replace("Alpha.", "A!").replace("Beta.", "B!"),
        })
      ).json()) as AgentProposalResponse;
      const [review] = await reviews();
      const before = (await readNote(ref)).updatedAt;
      const res = await decide({
        id: review.id,
        noteVersion: review.noteVersion,
        accept: [],
        reject: ["2:a"],
      });
      expect(((await res.json()) as ResolveProposalResponse).waiting).toBe(1);
      expect((await readNote(ref)).updatedAt).toBe(before); // nothing accepted: the file is untouched
      expect((await reviews())[0].changes.map((c) => c.key)).toEqual(["2:b"]);
      expect(await status(proposal.id)).toMatchObject({ status: "pending", waiting: 1 });

      const [again] = await reviews();
      await decide({ id: again.id, noteVersion: again.noteVersion, accept: [], reject: ["2:b"] });
      expect((await status(proposal.id)).status).toBe("dismissed");
    }));

  it("refuses to apply when the note changed during the review", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, decide } = await setUp();
      const note = await read();
      await propose({ baseVersion: note.version, content: note.content.replace("Alpha.", "A!") });
      const [review] = await reviews();
      await saveNote({ ref, content: NOTE + "\nMore.\n", baseVersion: note.version });
      const res = await decide({
        id: review.id,
        noteVersion: review.noteVersion,
        accept: ["2:a"],
        reject: [],
      });
      expect(res.status).toBe(409);
    }));

  it("makes a retried request harmless, and a newer proposal replaces the older one", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, status } = await setUp();
      const note = await read();
      const first = await propose({
        baseVersion: note.version,
        content: note.content.replace("Alpha.", "A1"),
        requestId: "run-1",
      });
      const retry = await propose({
        baseVersion: note.version,
        content: note.content.replace("Alpha.", "A1"),
        requestId: "run-1",
      });
      expect(first.status).toBe(201);
      expect(retry.status).toBe(200);
      const firstId = ((await first.json()) as AgentProposalResponse).proposal.id;
      expect(((await retry.json()) as AgentProposalResponse).proposal.id).toBe(firstId);

      await propose({ baseVersion: note.version, content: note.content.replace("Alpha.", "A2") });
      expect((await status(firstId)).status).toBe("replaced");
      expect((await reviews()).map((r) => r.changes[0].proposed)).toEqual(["## A\n\nA2\n\n"]);
    }));

  it("asks the harness to read again when its version is gone, and refuses a proposal that changes nothing", () =>
    withTempDataDir(async () => {
      const { read, propose } = await setUp();
      const note = await read();
      await saveNote({ ref, content: NOTE + "\nMore.\n", baseVersion: note.version });
      resetProposalBases(); // as after a restart
      const stale = await propose({ baseVersion: note.version, content: "x\n" });
      expect(stale.status).toBe(409);
      expect((await errorOf(stale)).message).toContain("Read the note again");

      const fresh = await read();
      const same = await propose({ baseVersion: fresh.version, content: fresh.content });
      expect(same.status).toBe(400);
    }));

  it("keeps to the integration's folders and its own proposals", () =>
    withTempDataDir(async () => {
      const { propose, owner } = await setUp();
      const outside = await call(agentProposals.POST, "POST", "/api/agent/proposals", {}, {});
      expect(outside.status).toBe(401);
      const journal = await propose({
        folder: "Journal",
        name: "Private",
        baseVersion: "0".repeat(16),
        content: "x\n",
      });
      expect(journal.status).toBe(404);
      const byOwner = await call(
        agentProposals.GET,
        "GET",
        "/api/agent/proposals?id=0123456789abcdef",
        owner,
      );
      expect(byOwner.status).toBe(401);
    }));

  it("follows a renamed note, and closes when the note is deleted", () =>
    withTempDataDir(async () => {
      const { read, propose, status } = await setUp();
      const note = await read();
      const { proposal } = (await (
        await propose({ baseVersion: note.version, content: note.content.replace("Alpha.", "A!") })
      ).json()) as AgentProposalResponse;
      await updateNote({ ref, newName: "Final" });
      expect(await status(proposal.id)).toMatchObject({
        status: "pending",
        note: { folder: "Essays", name: "Final" },
      });
      await deleteNote({ folder: "Essays", name: "Final" });
      expect(await status(proposal.id)).toMatchObject({ status: "orphaned", noteVersion: null });
    }));

  it("follows a renamed folder, and closes when the folder is deleted", () =>
    withTempDataDir(async () => {
      const { read, propose, status } = await setUp();
      const note = await read();
      const res = await propose({ baseVersion: note.version, content: note.content.replace("Alpha.", "A!") });
      const { proposal } = (await res.json()) as AgentProposalResponse;
      await renameFolder("Essays", "Writing");
      // The integration follows the rename too (see integrations.test.ts), so it can still see its proposal.
      expect((await status(proposal.id)).note).toEqual({ folder: "Writing", name: "Draft" });
      await deleteFolder("Writing");
      expect((await status(proposal.id)).status).toBe("orphaned");
    }));

  it("never changes the note when Apply fails because the proposal was replaced meanwhile", () =>
    withTempDataDir(async () => {
      const { read, propose, reviews, decide } = await setUp();
      const note = await read();
      await propose({ baseVersion: note.version, content: note.content.replace("Alpha.", "A!") });
      const [review] = await reviews();
      const [applied] = await Promise.all([
        decide({ id: review.id, noteVersion: review.noteVersion, accept: ["2:a"], reject: [] }),
        propose({ baseVersion: note.version, content: note.content.replace("Beta.", "B2") }),
      ]);
      const content = (await readNote(ref)).content;
      if (applied.status === 200) expect(content).toBe(NOTE.replace("Alpha.", "A!"));
      else expect(content).toBe(NOTE); // refused: nothing may have been written
    }));
});
