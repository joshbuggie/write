import { chmod } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveProposal } from "../proposal-review";
import { addProposal, createFolder, createNote, getProposal, readNote } from "./index";
import { withTempDataDir } from "./test-utils";

/**
 * Applying decisions when the proposal can't be written (docs/design-decisions.md#d31): a failure is never
 * reported as success. The proposals folder is made read-only to make the write fail for real.
 */

const NOTE = "## A\n\nAlpha.\n\n## B\n\nBeta.\n";
const ref = { folder: "Essays", name: "Draft" };

async function setUp(dataDir: string) {
  await createFolder("Essays");
  const note = await createNote({ ...ref, content: NOTE });
  const { proposal } = await addProposal({
    integrationId: "i1",
    source: "Harness",
    requestId: null,
    note: ref,
    baseVersion: note.version,
    base: NOTE,
    proposed: NOTE.replace("Alpha.", "A!").replace("Beta.", "B!"),
    summary: "",
    reasons: {},
  });
  /** Runs `fn` with the proposals folder read-only, restoring it before the temp folder is removed. */
  const whileLocked = async (fn: () => Promise<void>) => {
    const dir = path.join(dataDir, ".proposals");
    await chmod(dir, 0o555);
    try {
      await fn();
    } finally {
      await chmod(dir, 0o755);
    }
  };
  return { note, proposal, whileLocked };
}

afterEach(() => vi.restoreAllMocks());

// Root ignores directory permissions, so the injected failure can't happen there.
const asRoot = process.getuid?.() === 0;

describe.skipIf(asRoot)("recording decisions fails", () => {
  it("fails a rejection-only request, since nothing else was saved", () =>
    withTempDataDir(async (dataDir) => {
      const { note, proposal, whileLocked } = await setUp(dataDir);
      await whileLocked(() =>
        expect(
          resolveProposal({ id: proposal.id, noteVersion: note.version, accept: [], reject: ["2:a", "2:b"] }),
        ).rejects.toMatchObject({ code: "storage_unavailable" }),
      );
      expect(await getProposal(proposal.id)).toMatchObject({ status: "pending", decisions: [] });
      expect((await readNote(ref)).content).toBe(NOTE);
    }));

  it("still reports an accepted change it saved, and says which decisions weren't recorded", () =>
    withTempDataDir(async (dataDir) => {
      const { note, proposal, whileLocked } = await setUp(dataDir);
      let result!: Awaited<ReturnType<typeof resolveProposal>>;
      await whileLocked(async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        result = await resolveProposal({
          id: proposal.id,
          noteVersion: note.version,
          accept: ["2:a"],
          reject: ["2:b"],
        });
      });
      expect((await readNote(ref)).content).toBe(NOTE.replace("Alpha.", "A!"));
      expect(result.content).toBe(NOTE.replace("Alpha.", "A!"));
      expect(result.unrecorded.map((d) => [d.key, d.decision])).toEqual([
        ["2:a", "accepted"],
        ["2:b", "rejected"],
      ]);
      expect(result.waiting).toBe(1); // the rejection wasn't recorded, so B is still offered
      expect(await getProposal(proposal.id)).toMatchObject({ status: "pending", decisions: [] });
    }));
});
