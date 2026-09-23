"use client";

import { useEffect, useMemo, useState, type CSSProperties, type KeyboardEvent, type RefObject } from "react";
import type { ChatTurn } from "@/lib/api-contract";
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
import { NotConnected } from "./not-connected";
import { PromptCompose, type AiRequest } from "./prompt-compose";
import { PromptReply } from "./prompt-reply";
import { addedImageHosts } from "./reply-checks";
import { replyLabels } from "./reply-labels";
import { RequestPreview } from "./request-preview";
import { useReplyStream } from "./use-reply-stream";

type PromptWindowProps = {
  /** The window's root: AiAssist scrolls it into view, and focuses it when ⌘J is pressed elsewhere. */
  rootRef: RefObject<HTMLDivElement | null>;
  /** Desktop only: px from the top of the text column. */
  top: number;
  /**
   * "anchored" (the visual editor): under the target on desktop, docked on phones. "docked" (the Markdown
   * source editor, which can't place it at the caret): docked at the bottom on every screen.
   */
  placement?: "anchored" | "docked";
  /** The reply goes in as the raw Markdown it is (source editor), so there is no formatting to lose. */
  rawReply?: boolean;
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
  const stream = useReplyStream();
  // The turns of the latest request: the first request, then each earlier reply and follow-up.
  const [sent, setSent] = useState<ChatTurn[]>([]);
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

  /** Sends a conversation, exactly as "What gets sent" showed its first turn. */
  function send(next: AiRequest, turns: ChatTurn[]) {
    if (!connection) return;
    setRequest(next);
    setSent(turns);
    const system = settings.instructions.trim();
    void stream.start({ connectionId: connection.id, system, messages: turns });
    rootRef.current?.focus({ preventScroll: true }); // keeps Esc working while the field is gone
  }

  const run = (next: AiRequest) =>
    send(next, [{ role: "user", content: buildMessages(settings, context, next.prompt).user }]);

  /** A follow-up continues the conversation: the reply so far, then the new request. */
  const followUp = (text: string) =>
    send({ actionId: null, label: text, prompt: text }, [
      ...sent,
      { role: "assistant", content: stream.state?.text ?? "" },
      { role: "user", content: text },
    ]);

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
  const raw = props.rawReply ?? false;
  const plain = useMemo(() => done && !raw && !keepsFormatting(reply), [done, raw, reply]);
  const imageHosts = useMemo(
    () => (done ? addedImageHosts(reply, context.text) : []),
    [done, reply, context.text],
  );
  const quickAction = settings.quickActions.find((a) => a.id === request?.actionId);
  const { replaceLabel, insertLabel, primary } = replyLabels({ scope, target, plain, quickAction });
  const status = !stream.state
    ? ""
    : !done
      ? "Writing a reply…"
      : stream.state.error
        ? `The request failed. ${stream.state.error.message}`
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
        props.placement === "docked"
          ? "md:inset-x-auto md:bottom-4 md:left-1/2 md:w-[min(40rem,calc(100%-2rem))] md:-translate-x-1/2 md:rounded-xl md:border md:pb-0"
          : cn(
              "md:absolute md:-inset-x-3 md:top-[var(--ai-top,0px)] md:bottom-auto md:z-[5] md:max-h-none",
              "md:scroll-mt-28 md:scroll-mb-4 md:overflow-visible md:rounded-xl md:border md:pb-0",
            ),
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
          imageHosts={imageHosts}
          insertLabel={insertLabel}
          primary={primary}
          onStop={stream.stop}
          onRetry={() => send(request, sent)}
          onFollowUp={followUp}
          onOpenSettings={props.onOpenSettings}
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
