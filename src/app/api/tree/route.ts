import type { TreeResponse } from "@/lib/api-contract";
import { handle, json } from "@/lib/server/http";
import { ensureBootstrap, listTree } from "@/lib/server/storage";

/** The folder/note tree, same data the notes layout renders. */
export const GET = handle(async () => {
  await ensureBootstrap();
  const tree: TreeResponse = await listTree();
  return json(tree);
});
