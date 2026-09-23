"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import { Button } from "@/components/ui/button";
import { mockReply } from "@/lib/ai/mock/responses";
import { buildMessages, countWords, type AiContext } from "@/lib/ai/prompt";
import {
  connectionName,
  usableConnections,
  type AiScope,
  type AiSettings,
  type ApplyMode,
} from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import type { Target } from "./ai-target";
import { keepsFormatting } from "./apply-reply";
import { ConnectionPicker } from "./connection-picker";
import { PromptCompose, type AiRequest } from "./prompt-compose";
import { PromptReply } from "./prompt-reply";
import { RequestPreview } from "./request-preview";
import { useMockStream } from "./use-mock-stream";

type PromptWindowProps = {
  /** The window's root: AiAssist scrolls it into view, and focuses it when ⌘J is pressed elsewhere. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Desktop only: px from the top of the text column. */
  top: number;
  settings: AiSettings;
  target: Target;
  scope: AiScope;
  onScopeChange: (scope: AiScope) => void;
  /** The context the request carries for the current scope. */
  context: AiContext;
  /** Words in the whole note, for the scope toggle. */
  noteWords: number;
  onApply: (mode: ApplyMode, text: string) => void;
  onCopy: (text: string) => void;
  /** `refocus`: put the caret back in the note (Esc, Discard), rather than leave focus where a click put it. */
  onClose: (refocus: boolean) => void;
  onOpenSettings: () => void;
};

const words = (n: number) => (n > 0 ? ` · ${n} ${n === 1 ? "word" : "words"}` : "");

/**
 * The small window that opens at the cursor (⌘J or ✨). Phones get it docked above the keyboard instead,
 * where there is room for it. It never edits the note by itself: a reply is only a preview until the
 * user replaces or inserts it.
 */
export function PromptWindow(props: PromptWindowProps) {
  const { rootRef, top, settings, target, scope, context, onApply, onCopy, onClose } = props;
  const [draft, setDraft] = useState("");
  const [request, setRequest] = useState<AiRequest | null>(null);
  // Each window starts on the default connection; the picker switches it for this window only.
  const connections = usableConnections(settings);
  const [connectionId, setConnectionId] = useState(connections[0]?.id ?? "");
  const connection = connections.find((c) => c.id === connectionId) ?? connections[0] ?? null;
  const stream = useMockStream();
  const hasReply = request !== null;

  // Before anything is sent, a click elsewhere just closes the window. Once there is a reply it stays
  // until it is used or discarded, so a stray click can't throw it away.
  useEffect(() => {
    if (hasReply) return;
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Element;
      if (rootRef.current?.contains(target)) return;
      // Settings (opened from here) and the ✨ buttons, which toggle the window themselves.
      if (target.closest?.("dialog, [data-ai-trigger]")) return;
      onClose(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [hasReply, onClose, rootRef]);

  function run(next: AiRequest) {
    setRequest(next);
    // MOCKUP: a canned reply stands in for the server's streamed response.
    stream.start(mockReply(next.actionId, next.prompt, context.text, context.kind));
    rootRef.current?.focus({ preventScroll: true }); // keeps Esc working while the field is gone
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Escape" || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    if (stream.state && stream.state.phase !== "done") stream.stop();
    else onClose(true);
  }

  const reply = stream.state?.text ?? "";
  const done = stream.state?.phase === "done";
  // Checked once the reply is complete: what the note will get if the editor can't keep its formatting.
  const plain = useMemo(() => done && !keepsFormatting(reply), [done, reply]);
  // "Whole note" rewrites the note; otherwise Replace rewrites the target. An empty line has nothing to
  // replace, and a whole note is never replaced by escaped plain text.
  const replaceLabel =
    scope === "note"
      ? plain
        ? null
        : "Replace note"
      : target.kind === "cursor"
        ? null
        : `Replace ${target.name.toLowerCase()}`;
  const quickAction = settings.quickActions.find((a) => a.id === request?.actionId);
  // A typed request about the whole note is usually a question: its answer goes below, not over the text.
  const primary: ApplyMode =
    replaceLabel === null ? "insert" : (quickAction?.apply ?? (scope === "note" ? "insert" : "replace"));
  const status = !stream.state
    ? ""
    : !done
      ? "Writing a reply…"
      : stream.state.stopped
        ? "Stopped."
        : `Reply ready. ${replaceLabel ?? "Insert"}?`;

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-label="Ask AI"
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={{ "--ai-top": `${top}px` } as CSSProperties}
      className={cn(
        "fixed inset-x-0 bottom-[var(--kb)] z-40 cursor-auto overflow-y-auto overscroll-contain",
        "max-h-[calc(100dvh-var(--kb)-env(safe-area-inset-top)-3.5rem)]",
        "rounded-t-[14px] border-t border-line bg-surface text-ink shadow-pop outline-none",
        "pb-[max(0px,calc(env(safe-area-inset-bottom)-var(--kb)))]",
        "md:absolute md:-inset-x-3 md:top-[var(--ai-top,0px)] md:bottom-auto md:z-[5] md:max-h-none",
        "md:scroll-mt-28 md:scroll-mb-4 md:overflow-visible md:rounded-xl md:border md:pb-0",
      )}
    >
      {/* Mounted before the first send, so screen readers announce each change: one line per state, not per word. */}
      <p role="status" className="sr-only">
        {status}
      </p>
      {!connection ? (
        <NotConnected onOpenSettings={props.onOpenSettings} />
      ) : request && stream.state ? (
        <PromptReply
          request={request}
          via={connectionName(connection)}
          state={stream.state}
          replaceLabel={replaceLabel}
          plain={plain}
          insertLabel={target.kind === "cursor" ? "Insert" : "Insert below"}
          primary={primary}
          onStop={stream.stop}
          onRetry={() => run(request)}
          onFollowUp={(text) => run({ actionId: null, label: text, prompt: text })}
          onReplace={() => onApply("replace", reply)}
          onInsert={() => onApply("insert", reply)}
          onCopy={() => onCopy(reply)}
          onDiscard={() => onClose(true)}
        />
      ) : (
        <PromptCompose
          kind={target.kind}
          scope={scope}
          scopeOptions={[
            { value: "selection", label: target.name, detail: words(countWords(target.text)) },
            { value: "note", label: "Whole note", detail: words(props.noteWords) },
          ]}
          onScopeChange={props.onScopeChange}
          quickActions={settings.quickActions}
          onRun={run}
          onDraftChange={setDraft}
          picker={
            connections.length > 1 && (
              <ConnectionPicker connections={connections} value={connection.id} onChange={setConnectionId} />
            )
          }
          preview={
            <RequestPreview
              connection={connection}
              messages={buildMessages(settings, context, draft || "(your request)")}
              onEditInstructions={props.onOpenSettings}
            />
          }
        />
      )}
    </div>
  );
}

/** Switched on but not connected yet: say what's missing instead of failing on send. */
function NotConnected({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center">
      <Sparkles aria-hidden strokeWidth={1.75} className="size-[18px] shrink-0 text-accent max-md:hidden" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Connect a model to use AI</p>
        <p className="text-[13px] text-muted">
          Add a connection in Settings: a hosted API or a server on your network.
        </p>
      </div>
      {/* Focus lands here, so Esc (handled on the window) works without a text field to type in. */}
      <Button size="sm" variant="primary" autoFocus onClick={onOpenSettings}>
        Open Settings
      </Button>
    </div>
  );
}
