"use client";

import { useState } from "react";
import { Notice } from "@/components/note/notice";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api-client";
import type { CreatedBy } from "@/lib/proposals/types";

/**
 * Above a note an integration created: who made it and when (docs/design-decisions.md#d31). Such notes
 * are written without a review, so this says where one came from until the owner dismisses it.
 */
export function CreatedNotice({ createdBy }: { createdBy: CreatedBy | null }) {
  const toast = useToast();
  const [dismissed, setDismissed] = useState(false);
  if (!createdBy || dismissed) return null;

  function dismiss() {
    if (!createdBy) return;
    setDismissed(true);
    api.dismissCreatedNote(createdBy.id).catch(() => {
      setDismissed(false);
      toast.show({ message: "Couldn't dismiss that. Try again.", tone: "error" });
    });
  }

  const when = new Date(createdBy.createdAt).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <Notice onDismiss={dismiss}>
      {createdBy.source} created this note on {when}.
    </Notice>
  );
}
