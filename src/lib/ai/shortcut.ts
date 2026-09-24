/**
 * Keyboard shortcuts as strings like "Mod+Shift+J". "Mod" is ⌘ on a Mac and Ctrl elsewhere, the same
 * way the editor's own shortcuts work. Stored as text so the settings file stays readable.
 */

type Parsed = { alt: boolean; shift: boolean; key: string };

function parse(shortcut: string): Parsed | null {
  const parts = shortcut.split("+");
  const key = parts.pop();
  if (!key || !parts.includes("Mod")) return null;
  return { alt: parts.includes("Alt"), shift: parts.includes("Shift"), key: key.toUpperCase() };
}

/** Letters and digits are matched by physical key: with ⌥ held, macOS reports a symbol in `e.key`. */
function keyOf(e: KeyboardEvent): string | null {
  if (/^Key[A-Z]$/.test(e.code)) return e.code.slice(3);
  if (/^Digit\d$/.test(e.code)) return e.code.slice(5);
  if (e.key.length === 1) return e.key.toUpperCase();
  return null;
}

/** True when a keydown is this shortcut. */
export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  const s = parse(shortcut);
  if (!s || !(e.metaKey || e.ctrlKey)) return false;
  return e.altKey === s.alt && e.shiftKey === s.shift && keyOf(e) === s.key;
}

/** The shortcut a keydown spells, or null while only modifiers are held or ⌘/Ctrl is missing. */
export function shortcutFromEvent(e: KeyboardEvent): string | null {
  if (!(e.metaKey || e.ctrlKey) || ["Meta", "Control", "Alt", "Shift"].includes(e.key)) return null;
  const key = keyOf(e);
  if (!key) return null;
  return ["Mod", e.altKey && "Alt", e.shiftKey && "Shift", key].filter(Boolean).join("+");
}

/** "Mod+Shift+J" → "⌘⇧J", the way the toolbar tooltips show shortcuts. */
export function formatShortcut(shortcut: string): string {
  const s = parse(shortcut);
  if (!s) return shortcut;
  return `⌘${s.alt ? "⌥" : ""}${s.shift ? "⇧" : ""}${s.key}`;
}

/** Shortcuts the app or the browser already uses, and what for, so Settings can refuse them by name. */
const TAKEN: Record<string, string> = {
  "Mod+A": "Select all",
  "Mod+B": "Bold",
  "Mod+C": "Copy",
  "Mod+E": "Inline code",
  "Mod+F": "Find",
  "Mod+I": "Italic",
  "Mod+K": "Add link",
  "Mod+L": "the address bar",
  "Mod+N": "New window",
  "Mod+P": "Print",
  "Mod+Q": "Quit",
  "Mod+R": "Reload",
  "Mod+S": "Save",
  "Mod+T": "New tab",
  "Mod+V": "Paste",
  "Mod+W": "Close tab",
  "Mod+X": "Cut",
  "Mod+Z": "Undo",
  "Mod+\\": "Hide sidebar",
  "Mod+Shift+Z": "Redo",
  "Mod+Shift+S": "Strikethrough",
  "Mod+Shift+B": "Quote",
  "Mod+Shift+7": "Numbered list",
  "Mod+Shift+8": "Bulleted list",
  "Mod+Shift+9": "Task list",
  "Mod+Alt+N": "New note",
  "Mod+Alt+C": "Code block",
  "Mod+Alt+0": "Text",
  "Mod+Alt+1": "Heading 1",
  "Mod+Alt+2": "Heading 2",
  "Mod+Alt+3": "Heading 3",
  "Mod+Alt+4": "Heading 4",
  "Mod+Alt+5": "Heading 5",
  "Mod+Alt+6": "Heading 6",
  "Mod+Y": "Redo",
  "Mod+Shift+I": "Italic",
  "Mod+Shift+L": "the address bar",
  "Mod+Shift+N": "New private window",
  "Mod+Shift+T": "Reopen closed tab",
};

/** What a shortcut is already used for, or null when it's free. */
export function shortcutConflict(shortcut: string): string | null {
  return TAKEN[shortcut] ?? null;
}
