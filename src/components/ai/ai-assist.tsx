"use client";

import type { Editor } from "@tiptap/core";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { useActiveNote } from "@/components/shell/shell-context";
import { useToast } from "@/components/ui/toast";
import { countWords, type AiContext } from "@/lib/ai/prompt";
import type { AiScope, ApplyMode } from "@/lib/ai/settings";
import { useAi } from "./ai-provider";
import {
  captureTarget,
  currentRange,
  hideHighlight,
  noteMarkdown,
  setHighlightVisible,
  showHighlight,
  type Target,
} from "./ai-target";
import { insertBelow, keepsFormatting, replaceNote, replaceTarget } from "./apply-reply";
import { PromptWindow } from "./prompt-window";

/** One opening of the prompt window: what it works on, captured at that moment, and where it sits. */
type Session = { id: number; target: Target; scope: AiScope; note: string; top: number };

/** Space between the target's last line and the window. */
const GAP = 8;
const DESKTOP = "(min-width: 768px)";

/**
 * The AI assistant inside the visual editor. Mounted only while the assistant is switched on, so when
 * it's off the editor has no extra plugin, listener or state at all. It registers itself as the target
 * of the header button and the shortcut, and places the prompt window under the text it works on.
 */
export function AiAssist({ editor, column }: { editor: Editor; column: RefObject<HTMLDivElement | null> }) {
  const { settings, registerPromptTarget, openSettings } = useAi();
  const toast = useToast();
  const noteTitle = useActiveNote()?.ref.name ?? "";
  const [session, setSession] = useState<Session | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const nextId = useRef(1);
  const [dockHeight, setDockHeight] = useState(0);

  /** Desktop: the window's top inside the text column, just under the target's last line. */
  function topFor(pos: number) {
    const box = column.current?.getBoundingClientRect();
    if (!box) return 0;
    const end = Math.min(pos, editor.state.doc.content.size);
    return Math.round(editor.view.coordsAtPos(end).bottom - box.top + GAP);
  }

  const close = useCallback(
    (refocus: boolean) => {
      hideHighlight(editor);
      setSession(null);
      if (refocus && !editor.isDestroyed) editor.commands.focus();
    },
    [editor],
  );

  /**
   * ⌘J or ✨. Opens on what's under the cursor now. While open, pressing it again from inside the window
   * closes it; from anywhere else it brings focus back, so a reply is never thrown away by accident.
   */
  const open = useEffectEvent(() => {
    const root = rootRef.current;
    if (session && root) {
      if (root.contains(document.activeElement)) close(true);
      else (root.querySelector("textarea") ?? root).focus();
      return;
    }
    const target = captureTarget(editor);
    const scope = settings.defaultScope;
    showHighlight(editor, target);
    if (scope === "note") setHighlightVisible(editor, false);
    const id = nextId.current++;
    setSession({ id, target, scope, note: noteMarkdown(editor), top: topFor(target.to) });
  });

  useEffect(() => registerPromptTarget({ open: () => open() }), [registerPromptTarget]);
  useEffect(() => () => hideHighlight(editor), [editor]);

  /** Phones: the window is docked at the bottom, so scroll the target up above it. */
  const reveal = useEffectEvent(() => {
    const root = rootRef.current;
    if (!session || !root || window.matchMedia(DESKTOP).matches) return;
    const bottom = editor.view.coordsAtPos(currentRange(editor, session.target).to).bottom;
    const overlap = bottom + GAP * 2 - root.getBoundingClientRect().top;
    if (overlap > 0) window.scrollBy({ top: overlap });
  });
  const place = useEffectEvent(() => {
    setSession((s) => s && { ...s, top: topFor(currentRange(editor, s.target).to) });
  });

  const sessionId = session?.id;
  useLayoutEffect(() => {
    const root = rootRef.current;
    if (sessionId === undefined || !root) return;
    if (window.matchMedia(DESKTOP).matches) root.scrollIntoView({ block: "nearest" });
    else reveal();
    // Measure after useKeyboardInset has moved the docked window (it updates --kb in a frame of its own).
    let frame = 0;
    const later = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => (frame = requestAnimationFrame(reveal)));
    };
    const onResize = () => {
      place();
      later();
    };
    // A streaming reply or "What gets sent" makes the window taller.
    const grows = new ResizeObserver(() => {
      setDockHeight(root.offsetHeight);
      later();
    });
    grows.observe(root);
    const vv = window.visualViewport;
    window.addEventListener("resize", onResize);
    vv?.addEventListener("resize", onResize); // the iPhone keyboard opening moves the docked window up
    return () => {
      cancelAnimationFrame(frame);
      grows.disconnect();
      window.removeEventListener("resize", onResize);
      vv?.removeEventListener("resize", onResize);
    };
  }, [sessionId]);

  if (!session) return null;

  const context: AiContext =
    session.scope === "note"
      ? { kind: "note", text: session.note, noteTitle }
      : { kind: session.target.kind, text: session.target.text, noteTitle };

  function changeScope(scope: AiScope) {
    setSession((s) => s && { ...s, scope });
    setHighlightVisible(editor, scope !== "note");
  }

  function apply(mode: ApplyMode, text: string) {
    if (!session) return;
    const { target, scope } = session;
    const wholeNote = mode === "replace" && scope === "note";
    const ok =
      mode === "insert"
        ? insertBelow(editor, target, text)
        : wholeNote
          ? replaceNote(editor, text)
          : replaceTarget(editor, target, text);
    close(false);
    if (!ok) {
      toast.show({ message: "Couldn't put the reply into the note here.", tone: "error" });
      return;
    }
    const replaced = mode === "replace" && target.kind !== "cursor";
    const done = wholeNote
      ? "Replaced the note"
      : replaced
        ? "Replaced with the reply"
        : "Inserted the reply";
    toast.show({
      message: keepsFormatting(text)
        ? done
        : `${done} as plain text: the editor can’t keep all of its formatting.`,
      action: { label: "Undo", onClick: () => editor.chain().focus().undo().run() },
    });
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.show({ message: "Copied" });
    } catch {
      toast.show({ message: "Couldn't copy: the browser blocked the clipboard.", tone: "error" });
    }
  }

  return (
    <>
      {/* Phones: room below the text while the window is docked, so even the last paragraph can clear it. */}
      <div aria-hidden className="md:hidden" style={{ height: `calc(${dockHeight}px + var(--kb))` }} />
      <PromptWindow
        key={session.id}
        rootRef={rootRef}
        top={session.top}
        settings={settings}
        target={session.target}
        scope={session.scope}
        onScopeChange={changeScope}
        context={context}
        noteWords={countWords(session.note)}
        onApply={apply}
        onCopy={(text) => void copy(text)}
        onClose={close}
        onOpenSettings={openSettings}
      />
    </>
  );
}
