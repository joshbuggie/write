"use client";

import type { Editor } from "@tiptap/core";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { TextField } from "@/components/ui/text-field";

/** Schemes the Link dialog will write, and that Mod+click / "Open" will follow. */
const OPENABLE = /^(https?:|mailto:)/i;
const HAS_SCHEME = /^[a-z][a-z\d+.-]*:/i;
const INSERTABLE = /^(https?:|mailto:|tel:|\/|#)/i;

/**
 * "example.com" → "https://example.com"; leaves mailto:, relative and anchor links alone. Spaces are
 * percent-encoded because Tiptap writes `[a](my note.md)` without `<…>`, which breaks on reload.
 */
function normalizeHref(input: string): string {
  const href = input.trim().replace(/ /g, "%20");
  if (!href || HAS_SCHEME.test(href) || href.startsWith("/") || href.startsWith("#")) return href;
  return `https://${href}`;
}

/** Opens http(s)/mailto links in a new tab without giving it a handle to this page. */
export function openLinkSafely(href: string | null | undefined): boolean {
  if (!href || !OPENABLE.test(href)) return false;
  window.open(href, "_blank", "noopener,noreferrer");
  return true;
}

type LinkDialogProps = { editor: Editor; onClose: () => void };

/**
 * Add, edit, open or remove the link under the cursor (⌘K or the toolbar). Mount it only while open:
 * it reads the current link once, when it appears.
 */
export function LinkDialog({ editor, onClose }: LinkDialogProps) {
  const formId = useId();
  const [existing] = useState<string>(() => editor.getAttributes("link").href ?? "");
  const [url, setUrl] = useState(existing);
  const [error, setError] = useState<string | null>(null);

  function save(e: FormEvent) {
    e.preventDefault();
    const href = normalizeHref(url);
    if (!href) return remove();
    const chain = editor.chain().focus().extendMarkRange("link");
    // With nothing selected there is no text to wrap, so the URL itself becomes the link text.
    // insertContent skips the Link extension's URI check, hence the explicit allowlist here.
    const ok =
      editor.state.selection.empty && !existing
        ? INSERTABLE.test(href) &&
          chain.insertContent({ type: "text", text: href, marks: [{ type: "link", attrs: { href } }] }).run()
        : chain.setLink({ href }).run();
    if (!ok) {
      setError("That kind of link isn't allowed.");
      return;
    }
    onClose();
  }

  function remove() {
    editor.chain().focus().extendMarkRange("link").unsetLink().run();
    onClose();
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={existing ? "Edit link" : "Add link"}
      footer={
        <>
          {existing && OPENABLE.test(existing) && (
            <Button variant="ghost" onClick={() => openLinkSafely(existing)}>
              Open
            </Button>
          )}
          {existing && (
            <Button variant="ghost" onClick={remove}>
              Remove
            </Button>
          )}
          <Button variant="primary" type="submit" form={formId}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={save}>
        <TextField
          label="URL"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          autoFocus
          placeholder="https://"
          value={url}
          error={error}
          onChange={(e) => {
            setUrl(e.target.value);
            setError(null);
          }}
        />
      </form>
    </Dialog>
  );
}
