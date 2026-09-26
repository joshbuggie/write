import type { LaunchResponse } from "@/lib/api-contract";
import { handle, json, readJson } from "@/lib/server/http";
import { launch } from "@/lib/server/launch/launch";
import { isLaunchRequest } from "@/lib/server/validate-integrations";

/**
 * "Send to…" on a note (docs/design-decisions.md#d31): starts or continues a job in a harness. Owner only;
 * an integration token can't start jobs.
 */
export const POST = handle(async (req) => {
  const body: LaunchResponse = { job: await launch(await readJson(req, isLaunchRequest)) };
  return json(body, 201);
});
