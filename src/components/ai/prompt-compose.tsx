"use client";

import { ArrowUp, ChevronDown, Eye, Sparkles } from "lucide-react";
import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { IconButton } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import type { ContextKind } from "@/lib/ai/prompt";
import type { AiScope, QuickAction } from "@/lib/ai/settings";
import { PromptInput } from "./prompt-input";
import { ScopeToggle, type ScopeOption } from "./scope-toggle";

/** One request from the prompt window: a quick action or typed text. */
export type AiRequest = { actionId: string | null; label: string; prompt: string };

type PromptComposeProps = {
  kind: ContextKind;
  scope: AiScope;
  scopeOptions: [ScopeOption, ScopeOption];
  onScopeChange: (scope: AiScope) => void;
  quickActions: QuickAction[];
  onRun: (request: AiRequest) => void;
  /** Called as the draft changes, so "What gets sent" can show it. */
  onDraftChange: (draft: string) => void;
  /** The "What gets sent" panel, rendered under the footer while open. */
  preview: ReactNode;
  /** The connection picker, when more than one connection is saved. */
  picker?: ReactNode;
};

const PLACEHOLDER: Record<ContextKind, string> = {
  selection: "Ask AI to edit or explain the selection…",
  paragraph: "Ask AI about this paragraph…",
  cursor: "Ask AI to write something…",
  note: "Ask AI about this note…",
};

/** The prompt window before anything is sent: the request field, quick actions and what goes with it. */
export function PromptCompose(props: PromptComposeProps) {
  const { kind, scope, scopeOptions, onScopeChange, quickActions, onRun, onDraftChange, preview, picker } =
    props;
  const [draft, setDraft] = useState("");
  const [showSent, setShowSent] = useState(false);
  const sentRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (showSent) sentRef.current?.scrollIntoView({ block: "nearest" });
  }, [showSent]);

  const send = () => {
    const prompt = draft.trim();
    if (prompt) onRun({ actionId: null, label: prompt, prompt });
  };

  return (
    <>
      <div className="flex items-end gap-2 px-3 py-2">
        <Sparkles aria-hidden strokeWidth={1.75} className="mb-2.5 size-[18px] shrink-0 text-accent" />
        <PromptInput
          autoFocus
          label="Ask AI"
          placeholder={PLACEHOLDER[scope === "note" ? "note" : kind]}
          value={draft}
          onChange={(value) => {
            setDraft(value);
            onDraftChange(value);
          }}
          onSubmit={send}
        />
        <IconButton label="Send" icon={ArrowUp} variant="primary" disabled={!draft.trim()} onClick={send} />
      </div>

      {quickActions.length > 0 && (
        <div
          role="group"
          aria-label="Quick actions"
          className="flex [scrollbar-width:none] gap-1.5 overflow-x-auto px-3 pb-2.5 md:flex-wrap"
        >
          {quickActions.map((action) => (
            <button
              key={action.id}
              type="button"
              title={action.prompt}
              onClick={() => onRun({ actionId: action.id, label: action.label, prompt: action.prompt })}
              className={cn(
                "h-7 shrink-0 rounded-full border border-line bg-canvas px-2.5 text-[13px] whitespace-nowrap text-ink",
                "hover:border-line-strong hover:bg-hover pointer-coarse:h-11 pointer-coarse:px-3.5 pointer-coarse:text-[15px]",
              )}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center gap-1 border-t border-line px-2 py-1.5 md:gap-2">
        <ScopeToggle value={scope} options={scopeOptions} onChange={onScopeChange} />
        <span className="flex-1" />
        {picker}
        <button
          type="button"
          aria-label="What gets sent"
          aria-expanded={showSent}
          onPointerDown={(e) => e.preventDefault()} // keeps the iPhone keyboard up
          onClick={() => setShowSent((s) => !s)}
          className={cn(
            "inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[12.5px] text-muted",
            "hover:bg-hover hover:text-ink pointer-coarse:h-11 pointer-coarse:text-[14px]",
          )}
        >
          <Eye aria-hidden strokeWidth={1.75} className="size-5 md:hidden" />
          <span className="max-md:hidden">What gets sent</span>
          <ChevronDown
            aria-hidden
            strokeWidth={1.75}
            className={cn("size-3.5 transition-transform max-md:hidden", showSent && "rotate-180")}
          />
        </button>
      </div>
      {showSent && <div ref={sentRef}>{preview}</div>}
    </>
  );
}
