"use client";

import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { useActiveNote } from "@/components/shell/shell-context";
import { splitFrontmatter } from "@/lib/markdown/file-format";
import { countWords, type AiContext } from "@/lib/ai/prompt";
import type { AiScope, ApplyMode } from "@/lib/ai/settings";
import { useAi } from "./ai-provider";
import type { Target } from "./ai-target";
import { PromptWindow } from "./prompt-window";
import { captureSourceTarget, insertSourceBelow, replaceSource, replaceSourceNote } from "./source-target";
import { useApplyFeedback } from "./use-apply-feedback";

/**
 * One opening of the prompt window over the textarea: its target, and the note's body as it was then (the
 * front matter is left out, as in the visual editor, since Replace note keeps it as it is).
 */
type Session = { id: number; target: Target; scope: AiScope; note: string };

/**
 * The AI assistant in the Markdown source editor. Like the visual editor's, it is mounted only while the
 * assistant is on and registers itself for ⌘J and ✨; the window docks at the bottom, since a textarea
 * can't say where its caret is on screen. Replies go in as the Markdown they are.
 */
export function SourceAssist({ textarea }: { textarea: RefObject<HTMLTextAreaElement | null> }) {
  const { settings, registerPromptTarget, openSettings } = useAi();
  const feedback = useApplyFeedback();
  const noteTitle = useActiveNote()?.ref.name ?? "";
  const [session, setSession] = useState<Session | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  // The selection when the window opened, so closing it puts the caret back where it was.
  const selection = useRef<[number, number]>([0, 0]);

  function close(refocus: boolean) {
    setSession(null);
    const el = textarea.current;
    if (!refocus || !el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(...selection.current);
  }

  const open = useEffectEvent(() => {
    const root = rootRef.current;
    if (session && root) {
      if (root.contains(document.activeElement)) close(true);
      else (root.querySelector("textarea") ?? root).focus();
      return;
    }
    const el = textarea.current;
    if (!el) return;
    selection.current = [el.selectionStart, el.selectionEnd];
    const id = nextId.current++;
    const note = splitFrontmatter(el.value).body;
    setSession({ id, target: captureSourceTarget(el), scope: settings.defaultScope, note });
  });

  useEffect(() => registerPromptTarget({ open: () => open() }), [registerPromptTarget]);

  if (!session) return null;
  const { target, scope } = session;
  const context: AiContext =
    scope === "note"
      ? { kind: "note", text: session.note, noteTitle }
      : { kind: target.kind, text: target.text, noteTitle };

  function apply(mode: ApplyMode, text: string) {
    const el = textarea.current;
    if (!el) return;
    const wholeNote = mode === "replace" && scope === "note";
    const ok =
      mode === "insert"
        ? insertSourceBelow(el, target, text)
        : wholeNote
          ? replaceSourceNote(el, text)
          : replaceSource(el, target, text);
    setSession(null);
    feedback.applied(ok, { mode, wholeNote, atCursor: target.kind === "cursor" }, () => {
      el.focus();
      document.execCommand("undo");
    });
  }

  return (
    <PromptWindow
      key={session.id}
      rootRef={rootRef}
      top={0}
      placement="docked"
      rawReply
      settings={settings}
      target={target}
      scope={scope}
      onScopeChange={(next) => setSession((s) => s && { ...s, scope: next })}
      context={context}
      noteWords={countWords(session.note)}
      onApply={apply}
      onCopy={(text) => void feedback.copy(text)}
      onClose={close}
      onOpenSettings={openSettings}
    />
  );
}
