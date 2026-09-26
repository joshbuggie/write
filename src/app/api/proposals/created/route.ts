import { handle, noContent, requireParam } from "@/lib/server/http";
import { dismissCreatedRecord } from "@/lib/server/storage";

/**
 * `?id=`: the owner dismisses "created by" on a note an integration made (docs/design-decisions.md#d31).
 * The note itself is untouched. An id that is already gone is fine.
 */
export const DELETE = handle(async (req) => {
  await dismissCreatedRecord(requireParam(new URL(req.url), "id"));
  return noContent();
});
