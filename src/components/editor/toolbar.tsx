"use client";

import type { Editor } from "@tiptap/core";
import { useEditorState } from "@tiptap/react";
import { KeyboardOff } from "lucide-react";
import { Fragment, type KeyboardEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import { TEXT_COLUMN } from "./editor-skeleton";
import { TOOLBAR_ITEMS, type ToolbarContext } from "./toolbar-items";
import { useKeyboardInset } from "./use-keyboard-inset";

type ToolbarProps = { editor: Editor; onOpenLink: () => void };
type ButtonSize = "sm" | "lg";

/** Re-renders only when something the buttons show changes (useEditorState compares deeply). */
function useToolbarState(editor: Editor) {
  return useEditorState({
    editor,
    selector: ({ editor: e }) =>
      TOOLBAR_ITEMS.map((item) => ({
        visible: item.isVisible?.(e) ?? true,
        active: item.isActive?.(e) ?? false,
        disabled: item.isDisabled?.(e) ?? false,
      })),
  });
}

/** Keeps focus (and the iPhone keyboard) in the editor: the command runs on click instead. */
const keepEditorFocus = (e: PointerEvent) => e.preventDefault();

/** Arrow keys move between buttons, so the toolbar is a single Tab stop (WAI-ARIA toolbar pattern). */
function moveFocus(e: KeyboardEvent<HTMLDivElement>) {
  const step = { ArrowRight: 1, ArrowLeft: -1, Home: -Infinity, End: Infinity }[e.key];
  if (step === undefined) return;
  const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
  const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (current === -1) return;
  e.preventDefault();
  const next = Math.min(buttons.length - 1, Math.max(0, current + step));
  buttons[next]?.focus();
}

function ToolbarButtons({ editor, onOpenLink, size }: ToolbarProps & { size: ButtonSize }) {
  const states = useToolbarState(editor);
  const ctx: ToolbarContext = { openLinkDialog: onOpenLink };
  const visible = TOOLBAR_ITEMS.map((item, i) => ({ item, ...states[i] })).filter((x) => x.visible);

  return visible.map(({ item, active, disabled }, i) => {
    const Icon = item.icon;
    const startsGroup = i > 0 && visible[i - 1].item.group !== item.group;
    return (
      <Fragment key={item.id}>
        {startsGroup && <span aria-hidden className="mx-1 h-5 w-px shrink-0 bg-line" />}
        <button
          type="button"
          tabIndex={i === 0 ? 0 : -1}
          aria-label={item.label}
          title={item.shortcut ? `${item.label} (${item.shortcut})` : item.label}
          aria-pressed={item.isActive ? active : undefined}
          disabled={disabled}
          onPointerDown={keepEditorFocus}
          onClick={() => item.run(editor, ctx)}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md text-muted",
            "hover:bg-hover hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent",
            size === "sm" ? "size-8 pointer-coarse:size-11" : "size-11",
            active && "bg-active text-ink",
          )}
        >
          <Icon aria-hidden strokeWidth={1.75} className={size === "sm" ? "size-[18px]" : "size-5"} />
        </button>
      </Fragment>
    );
  });
}

/**
 * Desktop/tablet formatting bar (≥md). The note view renders it into a sticky slot under the header,
 * aligned with the text column. Compact 32px buttons for a mouse; 44px on touch screens such as an iPad.
 */
export function DesktopToolbar({ editor, onOpenLink }: ToolbarProps) {
  return (
    <div className="border-b border-line bg-canvas/85 backdrop-blur">
      <div
        role="toolbar"
        aria-label="Formatting"
        onKeyDown={moveFocus}
        className={cn(
          TEXT_COLUMN,
          "flex h-10 [scrollbar-width:none] items-center gap-0.5 overflow-x-auto pointer-coarse:h-12",
        )}
      >
        <ToolbarButtons editor={editor} onOpenLink={onOpenLink} size="sm" />
      </div>
    </div>
  );
}

/**
 * Phone formatting bar (<md). Shown only while the editor has focus, docked on top of the keyboard
 * via --kb, with 44px targets and a "hide keyboard" button pinned to the right.
 */
export function KeyboardToolbar({ editor, onOpenLink }: ToolbarProps) {
  const focused = useEditorState({ editor, selector: ({ editor: e }) => e.isFocused });
  const { keyboardOpen, zoomed } = useKeyboardInset();
  if (!focused || zoomed) return null;

  return createPortal(
    <div
      className={cn(
        "fixed inset-x-0 bottom-[var(--kb)] z-30 border-t border-line bg-canvas/95 backdrop-blur md:hidden",
        !keyboardOpen && "pb-[env(safe-area-inset-bottom)]",
      )}
    >
      <div className="flex h-11 items-center">
        <div
          role="toolbar"
          aria-label="Formatting"
          onKeyDown={moveFocus}
          className="flex h-full min-w-0 flex-1 [scrollbar-width:none] items-center overflow-x-auto overscroll-x-contain px-1"
        >
          <ToolbarButtons editor={editor} onOpenLink={onOpenLink} size="lg" />
        </div>
        <button
          type="button"
          aria-label="Hide keyboard"
          title="Hide keyboard"
          onPointerDown={keepEditorFocus}
          onClick={() => editor.commands.blur()}
          className="inline-flex size-11 shrink-0 items-center justify-center border-l border-line text-muted"
        >
          <KeyboardOff aria-hidden strokeWidth={1.75} className="size-5" />
        </button>
      </div>
    </div>,
    document.body,
  );
}
