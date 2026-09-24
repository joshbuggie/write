import type { ProposalsResponse } from "@/lib/api-contract";
import { handle, json, requireParam } from "@/lib/server/http";
import { reviewsFor } from "@/lib/server/proposal-review";
import { readNote } from "@/lib/server/storage";

/**
 * `?folder=&name=`: the note's pending proposals, each reviewed against the note as it is now
 * (docs/design-decisions.md#d31). The review dialog saves the note first, so this sees the latest text.
 */
export const GET = handle(async (req) => {
  const url = new URL(req.url);
  const note = await readNote({ folder: requireParam(url, "folder"), name: requireParam(url, "name") });
  const body: ProposalsResponse = { reviews: await reviewsFor(note) };
  return json(body);
});
