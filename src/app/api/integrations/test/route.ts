import type { TestLauncherResponse } from "@/lib/api-contract";
import { handle, json, readJson } from "@/lib/server/http";
import { testLauncher } from "@/lib/server/launch/launch";
import { isTestLauncherRequest } from "@/lib/server/validate-integrations";

/**
 * "Test connection" for a launcher in the Integrations dialog (docs/design-decisions.md#d31): checks the
 * address and key without starting anything. Like the AI assistant's test, it requests a URL the owner
 * typed, which is why it needs the owner's session (docs/design-decisions.md#d29).
 */
export const POST = handle(async (req) => {
  const body: TestLauncherResponse = {
    message: await testLauncher(await readJson(req, isTestLauncherRequest)),
  };
  return json(body);
});
