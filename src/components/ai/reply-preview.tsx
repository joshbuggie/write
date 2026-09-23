"use client";

import type { JSONContent } from "@tiptap/core";
import { EditorContent, useEditor } from "@tiptap/react";
import { useEffect, useState } from "react";
import { createExtensions } from "@/lib/markdown/extensions";

/** "example.com", or the address as written when it isn't a URL. */
function hostOf(src: string): string {
  try {
    return new URL(src).host || src;
  } catch {
    return src;
  }
}

/**
 * The reply with every image replaced by a text placeholder. A preview must not fetch anything: a model
 * following text injected into a note could otherwise leak that note through an image URL before the user
 * has decided anything (docs/design-decisions.md#d29).
 */
export function withoutImages(node: JSONContent): JSONContent {
  if (node.type === "image") {
    const alt = typeof node.attrs?.alt === "string" && node.attrs.alt ? node.attrs.alt : "image";
    const src = typeof node.attrs?.src === "string" ? node.attrs.src : "";
    return { type: "text", text: `[${alt}: ${hostOf(src)}]` };
  }
  return node.content ? { ...node, content: node.content.map(withoutImages) } : node;
}

/**
 * The reply rendered by the note's own schema, read-only: it looks like what Replace or Insert would put
 * into the note, and model output can only ever become nodes the schema allows (no raw HTML), with images
 * shown as placeholders. A reply the editor can't keep (`plain`) is shown as the plain text it would go in as.
 */
export function ReplyPreview({ markdown, plain }: { markdown: string; plain: boolean }) {
  const [extensions] = useState(() => createExtensions());
  const editor = useEditor({
    extensions,
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
    if (!editor || editor.isDestroyed || plain || !editor.markdown) return;
    editor.commands.setContent(withoutImages(editor.markdown.parse(markdown)), { emitUpdate: false });
  }, [editor, markdown, plain]);

  if (plain) return <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{markdown.trim()}</p>;
  return <EditorContent editor={editor} />;
}
