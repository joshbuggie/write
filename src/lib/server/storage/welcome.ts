/**
 * Written to notebook/Welcome.md on a brand-new data dir only. Deleting it is fine; it never comes back.
 * No leading H1: the file name is already the note's title, shown above the body.
 * It must not be lossy in the visual editor (welcome.test.ts), otherwise the very first note a
 * new user sees would open in source mode behind a "some formatting will be lost" banner.
 */
export const WELCOME_MARKDOWN = `Your notes are plain \`.md\` files in your data folder: one folder per notebook, one file per note, and the title is the file name. Edit them with any other app, sync them, or put them in git.

## Writing

Markdown shortcuts work as you type. Start a line with:

- \`#\` and a space for a heading, \`##\` for a smaller one
- \`-\` for a bullet list, \`1.\` for a numbered list
- \`[ ]\` for a task
- \`>\` for a quote
- three backticks for a code block

Wrap words in \`**\` for **bold** and \`*\` for *italic*.

Everything saves automatically. Press ⌘S (Ctrl+S) to save right away.

## Try it

- [x] Open this note
- [ ] Create a note with the New note button
- [ ] Download everything with **Download all (.zip)** at the bottom of the sidebar

A few more shortcuts:

| Shortcut | Action                   |
| -------- | ------------------------ |
| ⌘K       | Add a link               |
| ⌘\\\\      | Show or hide the sidebar |
`;
