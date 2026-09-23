"use client";

import type { Editor } from "@tiptap/core";
import { Selection } from "@tiptap/pm/state";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FrontmatterDetails } from "@/components/note/frontmatter-details";
import { useToast } from "@/components/ui/toast";
import { createExtensions } from "@/lib/markdown/extensions";
import { IGNORED_FILES_EVENT, PASTED_AS_TEXT_EVENT } from "@/lib/markdown/markdown-paste";
import { analyzeFidelity } from "@/lib/markdown/fidelity";
import { composeFile, splitFrontmatter } from "@/lib/markdown/file-format";
import { serializeBody } from "@/lib/markdown/serialize";
import { restoreSnapshot, takeSnapshot, visualContent } from "./editor-snapshot";
import { LinkDialog, openLinkSafely } from "./link-dialog";
import type { EditorReady } from "./note-editor";
import { EditorSkeleton } from "./editor-skeleton";
import { SourceEditor } from "./source-editor";
import { DesktopToolbar, KeyboardToolbar } from "./toolbar";
import "./editor.css";

type VisualEditorProps = {
  /** The full file text; front matter is split off and shown read-only above the body. */
  content: string;
  /** The user confirmed "Edit visually anyway", so a lossy note stays in the visual editor. */
  allowLossy: boolean;
  /** Sticky slot under the note header where the desktop toolbar is portaled (null until mounted). */
  toolbarSlot: HTMLElement | null;
  onReady: (ready: EditorReady) => void;
  onChange: () => void;
};

const NO_UPLOADS = "Image upload isn't supported yet — add files to your data folder.";
const PASTED_AS_TEXT = "Pasted as plain text: the visual editor can't keep all of this Markdown.";
/** Caret stays clear of the sticky header + toolbar above and the docked phone toolbar below. */
const CARET_MARGIN = { top: 112, right: 0, bottom: 72, left: 0 };

const isShortcut = (e: KeyboardEvent, key: string) =>
  (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === key;

/**
 * Tiptap's focus command focuses a frame later, so keys typed right after Enter in the title would still
 * land in the title. This focuses now; a position that no longer fits the document snaps to the nearest
 * valid caret.
 */
function focusAt(editor: Editor, at: "start" | number) {
  const { doc, tr } = editor.state;
  const selection =
    at === "start"
      ? Selection.atStart(doc)
      : Selection.near(doc.resolve(Math.min(Math.max(at, 0), doc.content.size)));
  editor.view.dispatch(tr.setSelection(selection).scrollIntoView());
  editor.view.focus();
}

/**
 * The Tiptap editor for a note body. It parses the markdown once, and on that same first render checks
 * whether saving it back would lose anything (see docs/design-decisions.md#d16). If it would, the note opens
 * in source mode instead, so nothing is silently dropped from the user's file.
 */
export function VisualEditor({ content, allowLossy, toolbarSlot, onReady, onChange }: VisualEditorProps) {
  const toast = useToast();
  const [linkOpen, setLinkOpen] = useState(false);
  const [extensions] = useState(() => createExtensions());
  const [parts] = useState(() => splitFrontmatter(content));

  const editor = useEditor({
    extensions,
    content: parts.body,
    contentType: "markdown",
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    onUpdate: () => onChange(),
    editorProps: {
      attributes: { class: "write-prose prose max-w-none", "aria-label": "Note body" },
      scrollMargin: CARET_MARGIN,
      scrollThreshold: CARET_MARGIN,
      handleKeyDown: (_view, event) => {
        if (!isShortcut(event, "k")) return false;
        event.preventDefault();
        setLinkOpen(true);
        return true;
      },
      // Links don't open on a plain click (that would make them impossible to edit); Mod+click does.
      handleClick: (_view, _pos, event) => {
        if (!(event.metaKey || event.ctrlKey)) return false;
        const anchor = (event.target as HTMLElement | null)?.closest("a");
        return openLinkSafely(anchor?.getAttribute("href"));
      },
    },
  });

  // Synchronous on the first render, so a lossy note never flashes the visual editor.
  const [opened] = useState(() => {
    const roundTripped = serializeBody(editor);
    return { roundTripped, fidelity: analyzeFidelity(parts.body, roundTripped) };
  });
  const lossReasons = opened.fidelity.kind === "lossy" && !allowLossy ? opened.fidelity.reasons : null;

  // Tiptap types `editor` as always set, but when the first commit lands more than 1 ms after the first
  // render (common while the editor chunk streams in), useEditor destroys that instance and creates a new
  // one, rendering null in between. Only a live instance may be handed to the note screen or rendered.
  const live = editor && !editor.isDestroyed ? editor : null;

  const announceReady = useEffectEvent((current: Editor) => {
    onReady({
      mode: "visual",
      sourceReason: null,
      // What "unchanged" means for this note: its normalized serialization, not the raw file.
      baseline: composeFile(parts.frontmatter, opened.roundTripped),
      handle: {
        getContent: () => visualContent(current, parts.frontmatter),
        setEditable: (editable) => current.setEditable(editable),
        focus: (at) => focusAt(current, at),
        hasFocus: () => current.isFocused,
        snapshot: () => takeSnapshot(current, parts.frontmatter),
        restore: (snapshot) => void restoreSnapshot(current, snapshot, parts.frontmatter),
      },
    });
  });

  useEffect(() => {
    if (!lossReasons && live && !live.isDestroyed) announceReady(live);
  }, [lossReasons, live]);

  // MarkdownPaste swallows pastes and drops that carry only files, and pastes Markdown the editor would
  // partly drop as plain text; tell the user why the paste didn't do what they expected.
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    const onIgnoredFiles = () => toast.show({ message: NO_UPLOADS });
    const onPastedAsText = () => toast.show({ message: PASTED_AS_TEXT });
    body.addEventListener(IGNORED_FILES_EVENT, onIgnoredFiles);
    body.addEventListener(PASTED_AS_TEXT_EVENT, onPastedAsText);
    return () => {
      body.removeEventListener(IGNORED_FILES_EVENT, onIgnoredFiles);
      body.removeEventListener(PASTED_AS_TEXT_EVENT, onPastedAsText);
    };
  }, [live, toast]);

  if (lossReasons) {
    return (
      <SourceEditor
        content={content}
        sourceReason={{ kind: "lossy", reasons: lossReasons }}
        onReady={onReady}
        onChange={onChange}
      />
    );
  }

  if (!live) return <EditorSkeleton />;
  const openLinkDialog = () => setLinkOpen(true);
  return (
    <>
      {toolbarSlot && createPortal(<DesktopToolbar editor={live} onOpenLink={openLinkDialog} />, toolbarSlot)}
      {parts.frontmatter && <FrontmatterDetails frontmatter={parts.frontmatter} />}
      <div
        ref={bodyRef}
        className="cursor-text pb-[40vh]"
        onClick={(e) => {
          // Clicking the empty space below the text puts the caret at the end, like a sheet of paper.
          if (e.target === e.currentTarget) live.commands.focus("end");
        }}
      >
        <EditorContent editor={live} />
      </div>
      <KeyboardToolbar editor={live} onOpenLink={openLinkDialog} />
      {linkOpen && <LinkDialog editor={live} onClose={() => setLinkOpen(false)} />}
    </>
  );
}
