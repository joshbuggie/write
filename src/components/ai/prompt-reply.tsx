"use client";

import { ArrowUp, Copy, CornerDownRight, RotateCcw, Sparkles, Square, TriangleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ApplyMode } from "@/lib/ai/settings";
import type { AiRequest } from "./prompt-compose";
import { PromptInput } from "./prompt-input";
import { ReplyPreview } from "./reply-preview";
import type { StreamState } from "./use-reply-stream";

type PromptReplyProps = {
  request: AiRequest;
  /** The connection's name, shown with the request so it's clear which model answered. */
  via: string;
  state: StreamState;
  /** "Replace selection", "Replace note"…, or null where there is nothing to replace (an empty line). */
  replaceLabel: string | null;
  /** The editor can't keep this reply's formatting: it is shown, and would go in, as plain text. */
  plain: boolean;
  /** Websites the reply's images would load from once it is in the note (none were in the text sent). */
  imageHosts: string[];
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
  onOpenSettings: () => void;
};

/** Why a finished reply may not be what was asked for, in words. */
function endNote(state: StreamState, plain: boolean): string | null {
  if (state.stopped) return "Stopped.";
  if (state.stop === "length") return "The reply was cut off at the model's length limit.";
  if (state.stop === "refusal") return "The model declined this request.";
  if (plain) return "The editor can’t keep all of this formatting, so it would go in as plain text.";
  return null;
}

/**
 * The prompt window once a request is sent: the reply as it streams in, then what to do with it. The
 * note is untouched until Replace or Insert is clicked, and either one is a single undo step. A failed
 * request says why, with Try again and a way to the connection settings.
 */
export function PromptReply(props: PromptReplyProps) {
  const { request, state, replaceLabel, insertLabel, primary, plain } = props;
  const [followUp, setFollowUp] = useState("");
  const followUpRef = useRef<HTMLTextAreaElement>(null);
  const done = state.phase === "done";
  const empty = !state.text.trim();
  const failed = Boolean(state.error);
  const note = done ? endNote(state, plain) : null;
  const variant = (mode: ApplyMode) => (primary === mode ? "primary" : "secondary");

  // Offer the follow-up field when the reply lands, but only if focus is still in the window: someone who
  // went back to typing in the note while it streamed keeps typing there.
  useEffect(() => {
    const field = followUpRef.current;
    if (done && field?.closest("[role=dialog]")?.contains(document.activeElement)) field.focus();
  }, [done]);

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
              <Spinner /> Waiting for {props.via}…
            </span>
          ) : (
            !empty && <ReplyPreview markdown={state.text} plain={plain} />
          )}
          {state.error && (
            <p className="mt-1 flex items-start gap-2 text-[14px] text-danger">
              <TriangleAlert aria-hidden strokeWidth={1.75} className="mt-0.5 size-4 shrink-0" />
              {state.error.message}
            </p>
          )}
          {note && <p className="mt-2 text-[13px] text-warning">{note}</p>}
          {done && props.imageHosts.length > 0 && (
            <p className="mt-2 text-[13px] text-warning">
              This reply adds images from {props.imageHosts.join(", ")}. They load from there once the reply
              is in the note.
            </p>
          )}
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
              {state.phase === "thinking" ? "Sending…" : "Writing…"}
              <span className="max-md:hidden"> · Esc to stop</span>
            </span>
          </>
        ) : failed ? (
          // A failed reply is incomplete even when part of it arrived: it can be copied, never applied.
          <>
            <Button size="sm" variant="primary" onClick={props.onRetry}>
              <RotateCcw aria-hidden strokeWidth={1.75} className="size-4" />
              Try again
            </Button>
            {!empty && <IconButton label="Copy" icon={Copy} onClick={props.onCopy} />}
            <Button size="sm" onClick={props.onOpenSettings}>
              Settings
            </Button>
            <span className="flex-1" />
            <Button size="sm" variant="ghost" onClick={props.onDiscard}>
              Close
            </Button>
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

      {done && !failed && !empty && (
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
    </>
  );
}
