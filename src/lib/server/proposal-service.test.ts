import { afterEach, describe, expect, it } from "vitest";
import { agentReadNote } from "./agent-actions";
import { resetProposalBases } from "./proposal-bases";
import { resolveProposal } from "./proposal-review";
import { proposeFromAgent } from "./proposal-service";
import { createFolder, createIntegration, createNote, readNote, saveNote, updateNote } from "./storage";
import { withTempDataDir } from "./storage/test-utils";

/** Retries and refusals of proposals from a harness (docs/design-decisions.md#d31). */

const ref = { folder: "Essays", name: "Draft" };
const NOTE = "## A\n\nAlpha.\n\n## B\n\nBeta.\n";

async function setUp() {
  await createFolder("Essays");
  await createFolder("Private");
  await createNote({ ...ref, content: NOTE });
  const make = (name: string) => createIntegration({ name, kind: "other", folders: ["Essays"] });
  const { integration } = await make("Harness");
  const { integration: other } = await make("Other");
  const note = await agentReadNote(integration, ref);
  const request = {
    ...ref,
    baseVersion: note.version,
    content: NOTE.replace("Alpha.", "Alpha, better."),
    requestId: "retry-1",
  };
  return { integration, other, note, request };
}

/** The owner edits the note and write restarts: the version the harness read is gone. */
async function editAndRestart(version: string) {
  await saveNote({ ref, content: NOTE + "\nOwner's line.\n", baseVersion: version });
  resetProposalBases();
}

afterEach(() => resetProposalBases());

describe("proposal retries", () => {
  it("answer from the saved proposal after an owner edit and a restart, pending or resolved", () =>
    withTempDataDir(async () => {
      const { integration, note, request } = await setUp();
      const first = await proposeFromAgent(integration, request);
      await editAndRestart(note.version);
      const again = await proposeFromAgent(integration, request);
      expect(again).toMatchObject({ created: false, proposal: { id: first.proposal.id, status: "pending" } });

      const current = await readNote(ref);
      await resolveProposal({
        id: first.proposal.id,
        noteVersion: current.version,
        accept: [],
        reject: ["2:a"],
      });
      resetProposalBases();
      const resolved = await proposeFromAgent(integration, request);
      expect(resolved).toMatchObject({
        created: false,
        proposal: { id: first.proposal.id, status: "dismissed" },
      });
      expect((await readNote(ref)).content).toBe(current.content);
    }));

  it("still refuse a new request whose version is gone, and never reach another integration's", () =>
    withTempDataDir(async () => {
      const { integration, other, note, request } = await setUp();
      await proposeFromAgent(integration, request);
      await editAndRestart(note.version);
      await expect(proposeFromAgent(integration, { ...request, requestId: "retry-2" })).rejects.toMatchObject(
        {
          code: "version_conflict",
        },
      );
      await expect(proposeFromAgent(other, request)).rejects.toMatchObject({ code: "version_conflict" });
    }));

  it("don't reveal a note the owner moved out of the integration's folders", () =>
    withTempDataDir(async () => {
      const { integration, request } = await setUp();
      await proposeFromAgent(integration, request);
      await updateNote({ ref, newFolder: "Private" });
      await expect(proposeFromAgent(integration, request)).rejects.toMatchObject({ code: "not_found" });
    }));
});

describe("proposals that move sections", () => {
  it("are refused before review, alone or with text edits, while keeping the order works", () =>
    withTempDataDir(async () => {
      const { integration, note } = await setUp();
      const send = (content: string) =>
        proposeFromAgent(integration, { ...ref, baseVersion: note.version, content });
      const refused = { code: "bad_request", message: expect.stringContaining("moves sections") };
      await expect(send("## B\n\nBeta.\n\n## A\n\nAlpha.\n")).rejects.toMatchObject(refused);
      await expect(send("## B\n\nBeta 2.\n\n## A\n\nAlpha 2.\n")).rejects.toMatchObject(refused);
      await expect(send("## C\n\nNew.\n\n## B\n\nBeta.\n\n## A\n\nAlpha.\n")).rejects.toMatchObject(refused);
      await expect(send("## A\n\nAlpha 2.\n\n## C\n\nNew.\n\n## B\n\nBeta.\n")).resolves.toMatchObject({
        created: true,
      });
    }));
});
