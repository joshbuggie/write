import { Editor } from "@tiptap/core";
import { afterEach, expect, it } from "vitest";
import { captureTarget, noteMarkdown, type Target } from "@/components/ai/ai-target";
import { insertBelow, keepsFormatting, replaceTarget } from "@/components/ai/apply-reply";
import { addedImageHosts } from "@/components/ai/reply-checks";
import { buildMessages, type ContextKind, unwrapReply } from "@/lib/ai/prompt";
import { DEFAULT_AI_SETTINGS, DEFAULT_QUICK_ACTIONS } from "@/lib/ai/settings";
import { createExtensions } from "@/lib/markdown/extensions";
import { serializeBody } from "@/lib/markdown/serialize";
import { openReply } from "@/lib/server/ai";
import { replyOf } from "@/lib/server/ai/test-utils";
import { describeEach, type LiveProvider, targetOf } from "./providers";

/**
 * The whole path of a quick action with the default Instructions (docs/design-decisions.md#d29): the
 * context the prompt window captures, the request "What gets sent" shows, a real reply, and Replace or
 * Insert in a headless editor. It checks what a user would notice: chatter around the reply, a fence
 * around it, lost formatting, or a change outside the passage. Each reply is annotated for reading.
 */

const NOTE = `# Trip plan

We leaves on friday morning and there going to drive to the coast. **Pack light**, bring the [checklist](https://example.com/list) and dont forget the charger.

- Book the campsite
- Buy snaks for the drive

Last line stays.
`;

const PARAGRAPH = NOTE.split("\n\n")[1];
const PREAMBLE = /^\s*(sure|certainly|of course|okay|ok|here(’|'s| is| are)|below is)\b/i;

const editors: Editor[] = [];
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

function noteEditor(): Editor {
  const editor = new Editor({
    element: null,
    extensions: createExtensions(),
    content: NOTE,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}

/** Document position just inside the first text node containing `needle`. */
function posOf(editor: Editor, needle: string, offset = 0): number {
  let found = -1;
  editor.state.doc.descendants((node, pos) => {
    const i = found < 0 && node.isText ? (node.text?.indexOf(needle) ?? -1) : -1;
    if (i >= 0) found = pos + i + offset;
  });
  if (found < 0) throw new Error(`"${needle}" not found`);
  return found;
}

const prompt = (id: string) => DEFAULT_QUICK_ACTIONS.find((a) => a.id === id)!.prompt;

/** Sends a quick action for a context exactly as the prompt window does, and checks the reply's shape. */
async function send(
  p: LiveProvider,
  kind: ContextKind,
  text: string,
  request: string,
  annotate: (m: string) => Promise<unknown>,
) {
  const { system, user } = buildMessages(
    DEFAULT_AI_SETTINGS,
    { kind, text, noteTitle: "Trip plan" },
    request,
  );
  const reply = await openReply(
    targetOf(p),
    { system, messages: [{ role: "user", content: user }] },
    new AbortController().signal,
  );
  const { text: raw, stop } = await replyOf(reply);
  const markdown = unwrapReply(raw); // as the prompt window shows and applies it
  await annotate(markdown === raw ? markdown : `(echoed the <note> tag; unwrapped)\n${markdown}`);
  expect(stop).toBe("end");
  expect(markdown.trim()).not.toBe("");
  expect(markdown).not.toMatch(PREAMBLE);
  expect(markdown.trim()).not.toMatch(/^```[\s\S]*```$/);
  expect(keepsFormatting(markdown)).toBe(true); // otherwise it would go in as plain text
  expect(addedImageHosts(markdown, text)).toEqual([]);
  return markdown;
}

// Replies vary between runs, and a small model sometimes drops a bold marker: one retry keeps a single weak
// reply from failing the run, while a model (or Instructions) that loses formatting every time still fails.
describeEach(
  "editing",
  (p: LiveProvider) => {
    it("Fix spelling & grammar replaces the paragraph and keeps its bold text and link", async ({
      annotate,
    }) => {
      const editor = noteEditor();
      editor.commands.setTextSelection(posOf(editor, "coast"));
      const target: Target = captureTarget(editor);
      expect(target.text.trim()).toBe(PARAGRAPH);
      const reply = await send(p, target.kind, target.text, prompt("fix"), annotate);
      expect(reply).toContain("**Pack light**");
      expect(reply).toContain("[checklist](https://example.com/list)");
      expect(reply).toMatch(/don['’]t/);
      expect(reply).not.toMatch(/We leaves/);

      // Its return value isn't checked: apply() chains focus(), which fails without a view (element: null).
      replaceTarget(editor, target, reply);
      const after = serializeBody(editor);
      expect(after.startsWith("# Trip plan\n\n")).toBe(true);
      expect(after.endsWith("- Book the campsite\n- Buy snaks for the drive\n\nLast line stays.\n")).toBe(
        true,
      );
    });

    it("Fix spelling & grammar on a selected list keeps it a list", async ({ annotate }) => {
      const editor = noteEditor();
      editor.commands.setTextSelection({
        from: posOf(editor, "Book"),
        to: posOf(editor, "for the drive", 13),
      });
      const target = captureTarget(editor);
      expect(target).toMatchObject({ kind: "selection", wholeBlocks: true });
      const reply = await send(p, target.kind, target.text, prompt("fix"), annotate);
      expect(reply.trim()).toMatch(/^[-*] /);

      replaceTarget(editor, target, reply);
      const after = serializeBody(editor);
      expect(after).toMatch(/\n- Book the campsite\.?\n- Buy snacks for the drive\.?\n/); // a period is fair
      expect(after.endsWith("\n\nLast line stays.\n")).toBe(true);
    });

    it("Summarize the whole note inserts a bulleted list below", async ({ annotate }) => {
      const editor = noteEditor();
      editor.commands.setTextSelection(posOf(editor, "Last"));
      const target = captureTarget(editor);
      const reply = await send(p, "note", noteMarkdown(editor), prompt("summarize"), annotate);
      expect(reply.trim()).toMatch(/^[-*] /m);

      insertBelow(editor, target, reply);
      const after = serializeBody(editor);
      expect(after.startsWith(NOTE)).toBe(true); // nothing above changed
      expect(after.length).toBeGreaterThan(NOTE.length);
    });

    it("Continue writing adds text in the same voice, without chatter", async ({ annotate }) => {
      const editor = noteEditor();
      editor.commands.setTextSelection(posOf(editor, "coast"));
      const target = captureTarget(editor);
      const reply = await send(p, target.kind, target.text, prompt("continue"), annotate);
      insertBelow(editor, target, reply);
      expect(serializeBody(editor)).toContain(`${PARAGRAPH}\n\n`);
    });

    it("answers a question on an empty line briefly", async ({ annotate }) => {
      const reply = await send(p, "cursor", "", "What is the capital of France? One word.", annotate);
      expect(reply.trim()).toMatch(/^\**Paris\**\.?$/);
    });
  },
  { retry: 1 },
);
