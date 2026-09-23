"use client";

import { Sparkles } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { formatShortcut } from "@/lib/ai/shortcut";
import { useAi } from "./ai-provider";

/**
 * The header's ✨ button. Renders nothing while the assistant is off, so a disabled feature leaves no
 * trace in the header. Pointer-down doesn't take focus, so the editor keeps its selection (and an iPhone
 * keeps its keyboard) until the prompt window opens. Where the prompt window can't open (MOCKUP: the
 * Markdown source editor), it stays focusable and says why instead of going silently dead.
 */
export function AiButton() {
  const { settings, canPrompt, openPrompt } = useAi();
  const toast = useToast();
  if (!settings.enabled) return null;
  return (
    <IconButton
      label="Ask AI"
      shortcut={formatShortcut(settings.shortcut)}
      icon={Sparkles}
      aria-disabled={!canPrompt || undefined}
      data-ai-trigger
      onPointerDown={(e) => e.preventDefault()}
      onClick={() =>
        canPrompt ? openPrompt() : toast.show({ message: "AI works in the visual editor for now." })
      }
      className="aria-disabled:opacity-50"
    />
  );
}
