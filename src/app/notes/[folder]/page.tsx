import { redirect } from "next/navigation";
import { LIBRARY_HREF } from "@/lib/routes";

/** Folders have no page of their own; this only exists so /notes/<folder> isn't a 404. */
export default function FolderPage() {
  redirect(LIBRARY_HREF);
}
