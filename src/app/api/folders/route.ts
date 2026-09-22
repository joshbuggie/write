import type { FolderResponse } from "@/lib/api-contract";
import { handle, json, noContent, readJson, requireParam } from "@/lib/server/http";
import { createFolder, deleteFolder, renameFolder } from "@/lib/server/storage";
import { isCreateFolderRequest, isRenameFolderRequest } from "@/lib/server/validate";

/** Create a folder. 400 invalid_name, 409 name_taken. */
export const POST = handle(async (req) => {
  const { name } = await readJson(req, isCreateFolderRequest);
  const body: FolderResponse = { folder: await createFolder(name) };
  return json(body, 201);
});

/** Rename a folder (moves everything inside it). 404 missing, 409 name_taken. */
export const PATCH = handle(async (req) => {
  const { name, newName } = await readJson(req, isRenameFolderRequest);
  const body: FolderResponse = { folder: await renameFolder(name, newName) };
  return json(body);
});

/** Move a folder to .trash. `?name=` */
export const DELETE = handle(async (req) => {
  await deleteFolder(requireParam(new URL(req.url), "name"));
  return noContent();
});
