"use client";

import { Send } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { NoteSendState } from "@/lib/launch/types";

/** Why "Send to…" is greyed out for a note in this folder, naming the harness when there is only one. */
export function blockedReason(blocked: string[], folder: string): string {
  const who = blocked.length === 1 ? `${blocked[0]} can't` : "No harness can";
  return `${who} read the folder “${folder}”. Add it under Integrations to send this note.`;
}

/**
 * The header's Send button (docs/design-decisions.md#d31): "Send to…" in one click instead of only in the ⋯
 * menu. When a harness has a launcher but can't read this note's folder, it stays, greyed out, and says
 * why when pressed (a tooltip alone never shows on a phone). It renders nothing for people without
 * launchers, so the header stays as it was for them.
 */
export function SendButton({
  send,
  folder,
  onClick,
}: {
  send: Pick<NoteSendState, "targets" | "blocked">;
  folder: string;
  onClick: () => void;
}) {
  const toast = useToast();
  const { targets, blocked } = send;
  if (targets.length > 0) {
    const label = targets.length === 1 ? `Send to ${targets[0].name}…` : "Send to a harness…";
    return <IconButton label={label} icon={Send} onClick={onClick} />;
  }
  if (blocked.length === 0) return null;
  const reason = blockedReason(blocked, folder);
  return (
    <IconButton
      label={reason}
      icon={Send}
      aria-disabled
      className="cursor-default opacity-50 hover:bg-transparent hover:text-muted active:bg-transparent"
      onClick={() => toast.show({ message: reason })}
    />
  );
}
