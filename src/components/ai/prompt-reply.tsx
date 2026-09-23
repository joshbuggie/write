"use client";

import { ArrowUp, Copy, CornerDownRight, RotateCcw, Sparkles, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ApplyMode } from "@/lib/ai/settings";
import type { AiRequest } from "./prompt-compose";
import { PromptInput } from "./prompt-input";
import { ReplyPreview } from "./reply-preview";
import type { StreamState } from "./use-mock-stream";

type PromptReplyProps = {
  request: AiRequest;
  /** The connection's name, shown with the request so it's clear which model answered. */
  via: string;
  state: StreamState;
  /** "Replace selection", "Replace note"…, or null where there is nothing to replace (an empty line). */
  replaceLabel: string | null;
  /** The editor can't keep this reply's formatting: it is shown, and would go in, as plain text. */
  plain: boolean;
  /** "Insert below", or "Insert" on an empty line. */
  insertLabel: string;
  /** Which button is primary: the quick action decides; typed requests default by what they are about. */
  primary: ApplyMode;
  onStop: () => void;
  onRetry: () => void;
  onFollowUp: (text: string) => void;
  onReplace: () => void;
  onInsert: () => void;
  onCopy: () => void;
  onDiscard: () => void;
};

/**
 * The prompt window once a request is sent: the reply as it streams in, then what to do with it. The
 * note is untouched until Replace or Insert is clicked, and either one is a single undo step.
 */
export function PromptReply(props: PromptReplyProps) {
  const { request, state, replaceLabel, insertLabel, primary, plain } = props;
  const [followUp, setFollowUp] = useState("");
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const done = state.phase === "done";

  // Offer the follow-up field when the reply lands, but only if focus is still in the window: someone who
  // went back to typing in the note while it streamed keeps typing there.
  useEffect(() => {
    const field = followUpRef.current;
    if (done && field?.closest("[role=dialog]")?.contains(document.activeElement)) field.focus();
  }, [done]);
  const empty = !state.text.trim();
  const variant = (mode: ApplyMode) => (primary === mode ? "primary" : "secondary");

  const sendFollowUp = () => {
    const text = followUp.trim();
    if (!text) return;
    setFollowUp("");
    props.onFollowUp(text);
  };

  return (
    <>
      <div className="px-3 pt-2.5">
        <p className="flex min-w-0 items-center gap-1.5 text-[13px] text-muted">
          <Sparkles aria-hidden strokeWidth={1.75} className="size-3.5 shrink-0 text-accent" />
          <span className="truncate">{request.label}</span>
          <span className="shrink-0 text-subtle">· {props.via}</span>
        </p>
        <div
          aria-busy={!done}
          className="mt-1.5 max-h-[min(40dvh,22rem)] overflow-y-auto pb-2.5 wrap-anywhere text-ink"
        >
          {state.phase === "thinking" ? (
            <span className="flex items-center gap-2 text-[15px] text-muted">
              <Spinner /> Thinking…
            </span>
          ) : (
            <ReplyPreview markdown={state.text} plain={plain} />
          )}
          {plain && (
            <p className="mt-2 text-[13px] text-warning">
              The editor can’t keep all of this formatting, so it would go in as plain text.
            </p>
          )}
          {state.stopped && <p className="text-[13px] text-subtle">Stopped</p>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-t border-line px-2 py-2">
        {!done ? (
          <>
            <Button size="sm" onClick={props.onStop}>
              <Square aria-hidden strokeWidth={1.75} className="size-3.5 fill-current" />
              Stop
            </Button>
            <span className="text-[12.5px] text-subtle">
              {state.phase === "thinking" ? "Waiting for the model…" : "Writing…"}
              <span className="max-md:hidden"> · Esc to stop</span>
            </span>
          </>
        ) : (
          <>
            {replaceLabel && (
              <Button size="sm" variant={variant("replace")} disabled={empty} onClick={props.onReplace}>
                {replaceLabel}
              </Button>
            )}
            <Button size="sm" variant={variant("insert")} disabled={empty} onClick={props.onInsert}>
              {insertLabel}
            </Button>
            <IconButton label="Copy" icon={Copy} disabled={empty} onClick={props.onCopy} />
            <IconButton label="Try again" icon={RotateCcw} onClick={props.onRetry} />
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={props.onDiscard}>
              Discard
            </Button>
          </>
        )}
      </div>

      {done && (
        <div className="flex items-end gap-2 border-t border-line px-3 py-1.5">
          <CornerDownRight aria-hidden strokeWidth={1.75} className="mb-2.5 size-4 shrink-0 text-subtle" />
          <PromptInput
            inputRef={followUpRef}
            label="Follow-up"
            placeholder="Tell AI what to change…"
            value={followUp}
            onChange={setFollowUp}
            onSubmit={sendFollowUp}
          />
          <IconButton
            label="Send follow-up"
            icon={ArrowUp}
            disabled={!followUp.trim()}
            onClick={sendFollowUp}
          />
        </div>
      )}
      <p className="border-t border-line px-3 py-1.5 text-[12px] text-subtle">
        Sample reply · mockup, no model was called
      </p>
    </>
  );
}
