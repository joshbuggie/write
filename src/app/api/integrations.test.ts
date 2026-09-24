import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AgentTreeResponse,
  ApiErrorBody,
  IntegrationTokenResponse,
  NoteResponse,
} from "@/lib/api-contract";
import { resetPasswordGuard } from "@/lib/server/auth";
import { sessionCookieFor, setUpTestAccount } from "@/lib/server/auth-test-utils";
import { resetIntegrationLastUsed } from "@/lib/server/integration-auth";
import { createFolder, createNote, type StoredAccount } from "@/lib/server/storage";
import { withTempDataDir, writeTestConfigFile } from "@/lib/server/storage/test-utils";
import * as agentNotes from "./agent/notes/route";
import * as agentTree from "./agent/tree/route";
import * as integrations from "./integrations/route";
import * as token from "./integrations/token/route";
import * as tree from "./tree/route";

/** The Integrations API and the agent routes, through the real route exports (docs/design-decisions.md#d31). */

type Handler = (req: Request, ctx: unknown) => Promise<Response>;

function call(
  handler: Handler,
  method: string,
  url: string,
  headers: Record<string, string> = {},
  body?: unknown,
) {
  const h = { ...headers, ...(body === undefined ? {} : { "content-type": "application/json" }) };
  const init = { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) };
  return handler(new Request(`http://localhost${url}`, init), { params: Promise.resolve({}) });
}

const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
const errorOf = async (res: Response) => ((await res.json()) as ApiErrorBody).error;

/** Signs in, makes "Essays" (with a note) and "Journal", and an integration that can read only Essays. */
async function setUp(): Promise<{ account: StoredAccount; cookie: string; made: IntegrationTokenResponse }> {
  const account = await setUpTestAccount("owner", "pw");
  const cookie = sessionCookieFor(account);
  await createFolder("Essays");
  await createFolder("Journal");
  await createNote({ folder: "Essays", name: "Draft", content: "# Draft\n" });
  await createNote({ folder: "Journal", name: "Private", content: "secret\n" });
  const res = await call(
    integrations.POST,
    "POST",
    "/api/integrations",
    { cookie },
    {
      name: "Turnstone",
      kind: "turnstone",
      folders: ["Essays"],
    },
  );
  expect(res.status).toBe(201);
  return { account, cookie, made: (await res.json()) as IntegrationTokenResponse };
}

beforeEach(() => vi.spyOn(console, "warn").mockImplementation(() => {}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  resetPasswordGuard();
  resetIntegrationLastUsed();
});

describe("/api/integrations", () => {
  it("lists integrations without tokens, and marks when a token was last used", () =>
    withTempDataDir(async () => {
      const { cookie, made } = await setUp();
      const list = async () =>
        await (await call(integrations.GET, "GET", "/api/integrations", { cookie })).json();
      expect(JSON.stringify(await list())).not.toContain(made.token);
      expect((await list()).integrations[0]).toMatchObject({ name: "Turnstone", lastUsedAt: null });

      await call(agentTree.GET, "GET", "/api/agent/tree", bearer(made.token));
      expect((await list()).integrations[0].lastUsedAt).toEqual(expect.any(String));
    }));

  it("can't be used with an integration token, so an agent can't widen its own access", () =>
    withTempDataDir(async () => {
      const { made } = await setUp();
      const patch = await call(integrations.PATCH, "PATCH", "/api/integrations", bearer(made.token), {
        id: made.integration.id,
        name: "Turnstone",
        kind: "turnstone",
        folders: ["Essays", "Journal"],
      });
      expect(patch.status).toBe(401);
      const rotate = await call(token.POST, "POST", "/api/integrations/token", bearer(made.token), {
        id: made.integration.id,
      });
      expect(rotate.status).toBe(401);
    }));

  it("replaces a token and removes an integration", () =>
    withTempDataDir(async () => {
      const { cookie, made } = await setUp();
      const res = await call(
        token.POST,
        "POST",
        "/api/integrations/token",
        { cookie },
        { id: made.integration.id },
      );
      const rotated = (await res.json()) as IntegrationTokenResponse;
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", bearer(made.token))).status).toBe(401);
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", bearer(rotated.token))).status).toBe(200);

      const del = await call(integrations.DELETE, "DELETE", `/api/integrations?id=${made.integration.id}`, {
        cookie,
      });
      expect(del.status).toBe(204);
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", bearer(rotated.token))).status).toBe(401);
    }));

  it("refuses a folder that doesn't exist", () =>
    withTempDataDir(async () => {
      const { cookie } = await setUp();
      const res = await call(
        integrations.POST,
        "POST",
        "/api/integrations",
        { cookie },
        {
          name: "Hermes",
          kind: "hermes",
          folders: ["Nope"],
        },
      );
      expect(res.status).toBe(404);
    }));
});

describe("integration tokens elsewhere", () => {
  it("are refused by the rest of the API and never count as password guesses", () =>
    withTempDataDir(async () => {
      const { made } = await setUp();
      for (let i = 0; i < 15; i++) {
        expect((await call(tree.GET, "GET", "/api/tree", bearer(made.token))).status).toBe(401);
      }
      expect((await call(tree.GET, "GET", "/api/tree", bearer("pw"))).status).toBe(200);
    }));
});

describe("/api/agent", () => {
  it("shows only the folders the integration can read", () =>
    withTempDataDir(async () => {
      const { made } = await setUp();
      const res = await call(agentTree.GET, "GET", "/api/agent/tree", bearer(made.token));
      const body = (await res.json()) as AgentTreeResponse;
      expect(body.folders.map((f) => f.name)).toEqual(["Essays"]);
    }));

  it("reads a note in scope, and answers a note outside it exactly like a missing one", () =>
    withTempDataDir(async () => {
      const { made } = await setUp();
      const ok = await call(
        agentNotes.GET,
        "GET",
        "/api/agent/notes?folder=Essays&name=Draft",
        bearer(made.token),
      );
      expect(((await ok.json()) as NoteResponse).note).toMatchObject({
        content: "# Draft\n",
        version: expect.any(String),
      });

      const outside = await call(
        agentNotes.GET,
        "GET",
        "/api/agent/notes?folder=Journal&name=Private",
        bearer(made.token),
      );
      const missing = await call(
        agentNotes.GET,
        "GET",
        "/api/agent/notes?folder=Essays&name=Nope",
        bearer(made.token),
      );
      expect(outside.status).toBe(404);
      expect(await errorOf(outside)).toEqual(await errorOf(missing));
    }));

  it("needs an integration token: a session cookie or the password isn't enough, even with sign-in off", () =>
    withTempDataDir(async () => {
      const { cookie } = await setUp();
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", { cookie })).status).toBe(401);
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", bearer("pw"))).status).toBe(401);
      vi.stubEnv("WRITE_AUTH", "off");
      const res = await call(agentTree.GET, "GET", "/api/agent/tree");
      expect(res.status).toBe(401);
      expect((await errorOf(res)).message).toContain("integration token");
    }));

  it("fails closed when integrations.json is broken", () =>
    withTempDataDir(async () => {
      const { made } = await setUp();
      await writeTestConfigFile("integrations.json", "not json");
      expect((await call(agentTree.GET, "GET", "/api/agent/tree", bearer(made.token))).status).toBe(503);
    }));
});
