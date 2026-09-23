"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { createExtensions } from "@/lib/markdown/extensions";

/**
 * The reply rendered by the note's own schema, read-only: it looks like what Replace or Insert would put
 * into the note, and model output can only ever become nodes the schema allows (no raw HTML). A reply the
 * editor can't keep (`plain`) is shown as the plain text it would go in as.
 */
export function ReplyPreview({ markdown, plain }: { markdown: string; plain: boolean }) {
  const [extensions] = useState(() => createExtensions());
  const editor = useEditor({
    extensions,
    content: markdown,
    contentType: "markdown",
    editable: false,
    immediatelyRender: true,
    shouldRerenderOnTransaction: false,
    editorProps: {
      // Tiptap marks every editor role="textbox"; this one can't be edited, so it's a labelled region.
      attributes: {
        class: "write-prose write-ai-reply prose max-w-none",
        role: "region",
        "aria-label": "Reply",
      },
    },
  });

  useEffect(() => {
    if (editor && !editor.isDestroyed && !plain) {
      editor.commands.setContent(markdown, { contentType: "markdown", emitUpdate: false });
    }
  }, [editor, markdown, plain]);

  if (plain) return <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{markdown.trim()}</p>;
  return <EditorContent editor={editor} />;
}
