import { markdownHeadings } from "@/lib/rail/markdown-headings";

/** A heading as the rail uses it: its text and level, and its box in page coordinates of the scroll area. */
export type RailHeading = { title: string; level: number; top: number; left: number; height: number };

/** Converts a viewport rect to page coordinates of the scroll area (see useRailLayout). */
export type ToPage = (rect: {
  top: number;
  left: number;
  height: number;
}) => Omit<RailHeading, "title" | "level">;

/**
 * Source-mode notes longer than this aren't measured: laying out a copy of a multi-megabyte note on every
 * pause in typing would stall the page. The rail still scrolls them; it just has no heading marks.
 */
const MAX_MEASURED = 300_000;

/** The styles that decide where a textarea wraps its lines, copied onto the measuring copy. */
const WRAP_STYLES = [
  "boxSizing",
  "width",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "fontFeatureSettings",
  "letterSpacing",
  "lineHeight",
  "tabSize",
  "textIndent",
  "wordSpacing",
] as const;

/**
 * Where each heading line of a source-mode textarea sits. A textarea has no element per line, so this lays
 * out a hidden copy of the text with the same wrapping and a marker at the start of each heading line.
 */
function textareaHeadings(textarea: HTMLTextAreaElement, toPage: ToPage): RailHeading[] {
  const text = textarea.value;
  if (text.length > MAX_MEASURED) return [];
  const headings = markdownHeadings(text);
  if (headings.length === 0) return [];

  const style = getComputedStyle(textarea);
  const copy = document.createElement("div");
  for (const name of WRAP_STYLES) copy.style[name] = style[name];
  Object.assign(copy.style, {
    position: "absolute",
    top: "0",
    left: "-99999px",
    visibility: "hidden",
    whiteSpace: "pre-wrap",
    overflowWrap: "break-word",
    borderStyle: "solid",
  });
  let from = 0;
  const markers = headings.map((h) => {
    copy.append(text.slice(from, h.offset));
    const marker = document.createElement("span");
    marker.textContent = "​";
    copy.append(marker);
    from = h.offset;
    return marker;
  });
  document.body.append(copy);
  const box = textarea.getBoundingClientRect();
  const border = parseFloat(style.borderTopWidth) || 0;
  const lineHeight = parseFloat(style.lineHeight) || 24;
  const left = box.left + (parseFloat(style.paddingLeft) || 0);
  const result = headings.map((h, i) => ({
    title: h.title,
    level: h.level,
    ...toPage({ top: box.top + border + markers[i].offsetTop, left, height: lineHeight }),
  }));
  copy.remove();
  return result;
}

/**
 * The note body's headings (levels 1–3) in document order, from whichever editor is mounted in `root`:
 * the visual editor's heading elements, or the heading lines of the source-mode textarea.
 */
export function readHeadings(root: HTMLElement, toPage: ToPage): RailHeading[] {
  const textarea = root.querySelector("textarea");
  if (textarea) return textareaHeadings(textarea, toPage);
  const headings: RailHeading[] = [];
  for (const el of root.querySelectorAll<HTMLElement>(".ProseMirror :is(h1, h2, h3)")) {
    const title = el.textContent?.trim();
    if (!title) continue;
    headings.push({ title, level: Number(el.tagName[1]), ...toPage(el.getBoundingClientRect()) });
  }
  return headings;
}
