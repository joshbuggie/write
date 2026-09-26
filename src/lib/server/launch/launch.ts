import { randomBytes } from "node:crypto";
import type { JobView, LaunchRequest, TestLauncherRequest } from "@/lib/api-contract";
import { buildBrief } from "@/lib/launch/brief";
import { HttpError } from "../http";
import {
  canReadFolder,
  latestJob,
  mergeLauncher,
  readIntegrations,
  readNote,
  saveJob,
  StorageError,
  type StoredIntegration,
  type StoredJob,
} from "../storage";
import { launcherFor, type LaunchJob } from "./launchers";

/**
 * "Send to…" (docs/design-decisions.md#d31): starts a job in a harness for one note, or continues the last
 * one for that note so the harness keeps its context across passes. The owner's own action, so it runs
 * with the owner's session, never an integration token.
 */

async function integrationById(id: string): Promise<StoredIntegration> {
  const found = (await readIntegrations()).find((i) => i.id === id);
  if (!found) throw new StorageError("not_found", "That integration no longer exists.");
  return found;
}

export const toJobView = (job: StoredJob, source: string): JobView => ({
  id: job.id,
  integrationId: job.integrationId,
  source,
  note: job.note,
  createdAt: job.createdAt,
  continued: job.continued,
});

export async function launch(req: LaunchRequest): Promise<JobView> {
  const integration = await integrationById(req.integrationId);
  const launcher = integration.launcher;
  if (!launcher) {
    throw new HttpError(
      "bad_request",
      `Set up how write starts jobs in ${integration.name} first, under Integrations.`,
    );
  }
  const note = await readNote({ folder: req.folder, name: req.name });
  if (note.readOnly)
    throw new StorageError("read_only", "This note can't be edited here, so it can't take proposals.");
  if (!canReadFolder(integration, note.folder)) {
    throw new HttpError(
      "bad_request",
      `${integration.name} can't read the folder "${note.folder}". Add the folder to it under Integrations first.`,
    );
  }
  const ref = { folder: note.folder, name: note.name };
  const prev = req.fresh ? null : await latestJob(integration.id, ref);
  const id = randomBytes(16).toString("hex");
  const job = (continuing: boolean): LaunchJob => ({
    id,
    note: ref,
    instruction: req.instruction,
    sections: req.sections,
    brief: buildBrief({
      note: ref,
      instruction: req.instruction,
      sections: req.sections,
      jobId: id,
      continuing,
    }),
  });
  const runner = launcherFor(integration.kind);
  const continued = prev ? await runner.continue(launcher, prev, job(true)) : null;
  const started = continued ?? (await runner.start(launcher, job(false)));
  const stored: StoredJob = {
    id,
    integrationId: integration.id,
    kind: integration.kind,
    note: ref,
    instruction: req.instruction,
    sections: req.sections,
    ref: started,
    continued: continued !== null,
    createdAt: new Date().toISOString(),
  };
  await saveJob(stored);
  return toJobView(stored, integration.name);
}

/** "Test connection" in the dialog: the launcher as typed, with the saved key when it is for the same server. */
export async function testLauncher(req: TestLauncherRequest): Promise<string> {
  const saved = req.integrationId
    ? (await readIntegrations()).find((i) => i.id === req.integrationId)
    : undefined;
  const launcher = mergeLauncher(req.launcher, saved?.launcher ?? null);
  return launcherFor(req.kind).test(launcher);
}
