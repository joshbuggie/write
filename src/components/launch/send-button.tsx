"use client";

import { Send } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import type { SendTarget } from "@/lib/launch/types";

/**
 * The header's Send button (docs/design-decisions.md#d31): "Send to…" in one click instead of only in the ⋯
 * menu. Renders nothing when no integration can take this note, so the header stays as it was for people
 * without harnesses.
 */
export function SendButton({ targets, onClick }: { targets: SendTarget[]; onClick: () => void }) {
  if (targets.length === 0) return null;
  const label = targets.length === 1 ? `Send to ${targets[0].name}…` : "Send to a harness…";
  return <IconButton label={label} icon={Send} onClick={onClick} />;
}
