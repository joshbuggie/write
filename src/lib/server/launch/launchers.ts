import type { IntegrationKind } from "@/lib/integrations";
import type { NoteRef } from "@/lib/types";
import { HttpError } from "../http";
import type { JobRef, StoredJob, StoredLauncher } from "../storage";
import { callHarness, errorMessage, harnessUrl, type HarnessResponse } from "./http";

/**
 * Starting and continuing a job in each kind of harness (docs/design-decisions.md#d31). A launcher only
 * starts work and returns the harness's reference for it; the results come back as proposals through
 * write's MCP endpoint, so nothing here reads the harness's events or replies.
 */

/** What a launcher gets for a job: its id (the retry-safe id where the harness takes one) and the brief. */
export interface LaunchJob {
  id: string;
  note: NoteRef;
  instruction: string;
  sections: string[];
  brief: string;
}

export interface Launcher {
  /** Starts a new job and returns the harness's reference for it. */
  start(l: StoredLauncher, job: LaunchJob): Promise<JobRef>;
  /** Continues `prev`'s conversation, or returns null when it no longer exists (start a new one then). */
  continue(l: StoredLauncher, prev: StoredJob, job: LaunchJob): Promise<JobRef | null>;
  /** Checks the address and key without starting anything; says what the harness reported. */
  test(l: StoredLauncher): Promise<string>;
}

const auth = (l: StoredLauncher): Record<string, string> =>
  l.key ? { authorization: `Bearer ${l.key}` } : {};

/** Throws harness_error for a non-2xx answer, naming the host and the harness's own message. */
function ok(res: HarnessResponse, url: URL): HarnessResponse {
  if (res.status >= 200 && res.status < 300) return res;
  const hint =
    res.status === 401 || res.status === 403 ? " Check the key saved for it under Integrations." : "";
  throw new HttpError("harness_error", `${url.host} answered ${res.status}: ${errorMessage(res)}.${hint}`);
}

const field = (res: HarnessResponse, name: string): string => {
  const v = (res.json as Record<string, unknown> | null)?.[name];
  if (typeof v !== "string" || !v)
    throw new HttpError("harness_error", `The harness didn't return a ${name}.`);
  return v;
};

/** Turnstone's names for write's tools, as its MCP server name prefixes them. */
const turnstoneTools = (server: string) =>
  ["list_notes", "read_note", "propose_changes", "get_proposal"].map((t) => `mcp__${server}__${t}`);

const title = (job: LaunchJob) => `write: ${job.note.name}`;

const turnstone: Launcher = {
  async start(l, job) {
    if (l.turnstoneMode === "coordinator") {
      const url = harnessUrl(l.url, "/v1/api/workstreams/new");
      const res = ok(
        await callHarness({
          url,
          method: "POST",
          headers: auth(l),
          body: { name: title(job), initial_message: job.brief },
          ca: l.ca,
        }),
        url,
      );
      return { wsId: field(res, "ws_id"), coordinator: true };
    }
    const url = harnessUrl(l.url, "/v1/api/route/workstreams/new");
    const body = {
      ws_id: job.id,
      name: title(job),
      initial_message: job.brief,
      auto_approve_tools: turnstoneTools(l.mcpServerName),
    };
    const res = await callHarness({ url, method: "POST", headers: auth(l), body, ca: l.ca });
    if (res.status === 409) return { wsId: job.id, coordinator: false }; // a retry of this same job: it exists
    return { wsId: field(ok(res, url), "ws_id"), coordinator: false };
  },
  async continue(l, prev, job) {
    if (!prev.ref.wsId) return null;
    const path = prev.ref.coordinator ? "/v1/api/workstreams/" : "/v1/api/route/workstreams/";
    const url = harnessUrl(l.url, `${path}${encodeURIComponent(prev.ref.wsId)}/send`);
    const res = await callHarness({
      url,
      method: "POST",
      headers: auth(l),
      body: { message: job.brief },
      ca: l.ca,
    });
    if (res.status === 404) return null;
    ok(res, url);
    return prev.ref;
  },
  async test(l) {
    const url = harnessUrl(l.url, "/v1/api/auth/whoami");
    const res = ok(
      await callHarness({ url, method: "GET", headers: auth(l), ca: l.ca, timeoutMs: 20_000 }),
      url,
    );
    const who = res.json as { username?: string; permissions?: string } | null;
    const perms = (who?.permissions ?? "").split(",");
    const missing = [
      "workstreams.create",
      ...(l.turnstoneMode === "coordinator" ? ["admin.coordinator"] : []),
    ].filter((p) => !perms.includes(p));
    const as = who?.username ? ` as ${who.username}` : "";
    return missing.length
      ? `Signed in to Turnstone${as}, but the token lacks ${missing.join(" and ")}, which starting jobs needs.`
      : `Signed in to Turnstone${as}.`;
  },
};

/** Hermes's API base ends in /v1; accept the address with or without it. */
const hermesUrl = (l: StoredLauncher, path: string) =>
  harnessUrl(/\/v1\/?$/.test(l.url.trim()) ? l.url : `${l.url.trim().replace(/\/+$/, "")}/v1`, path);

const hermes: Launcher = {
  async start(l, job) {
    return hermesRun(l, job, `write-${job.id}`);
  },
  async continue(l, prev, job) {
    return prev.ref.sessionId ? hermesRun(l, job, prev.ref.sessionId) : null;
  },
  async test(l) {
    const url = hermesUrl(l, "/models");
    const res = ok(
      await callHarness({ url, method: "GET", headers: auth(l), ca: l.ca, timeoutMs: 20_000 }),
      url,
    );
    const model = ((res.json as { data?: { id?: string }[] } | null)?.data ?? [])[0]?.id;
    return `Connected to Hermes Agent${model ? ` (${model})` : ""}.`;
  },
};

async function hermesRun(l: StoredLauncher, job: LaunchJob, sessionId: string): Promise<JobRef> {
  const url = hermesUrl(l, "/runs");
  const headers = { ...auth(l), "idempotency-key": job.id };
  const body = { input: job.brief, session_id: sessionId };
  const res = ok(await callHarness({ url, method: "POST", headers, body, ca: l.ca }), url);
  return { sessionId, runId: field(res, "run_id") };
}

/** Any other harness: one POST with everything it needs to start the work itself. */
const webhook: Launcher = {
  async start(l, job) {
    await postWebhook(l, job, null);
    return {};
  },
  async continue(l, prev, job) {
    await postWebhook(l, job, prev.id);
    return prev.ref;
  },
  async test() {
    return "Webhooks are only called when you send a note, so there is nothing to test here.";
  },
};

async function postWebhook(l: StoredLauncher, job: LaunchJob, previousJobId: string | null): Promise<void> {
  const url = harnessUrl(l.url, "");
  const body = {
    event: "write.send",
    jobId: job.id,
    previousJobId,
    note: job.note,
    instruction: job.instruction,
    sections: job.sections,
    brief: job.brief,
  };
  ok(await callHarness({ url, method: "POST", headers: auth(l), body, ca: l.ca }), url);
}

/** The launcher for an integration's kind. */
export function launcherFor(kind: IntegrationKind): Launcher {
  return kind === "turnstone" ? turnstone : kind === "hermes" ? hermes : webhook;
}
