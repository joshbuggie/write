"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

type PromptInputProps = {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
  /** Enter sends; Shift+Enter adds a line. */
  onSubmit: () => void;
  autoFocus?: boolean;
  /** For callers that focus the field themselves. */
  inputRef?: RefObject<HTMLTextAreaElement | null>;
};

/**
 * The prompt window's text field: a textarea that grows with its text up to a few lines, so a longer
 * request stays readable, while Enter still sends like a single-line field.
 */
export function PromptInput(props: PromptInputProps) {
  const { label, placeholder, value, onChange, onSubmit, autoFocus, inputRef } = props;
  const ownRef = useRef<HTMLTextAreaElement>(null);
  const ref = inputRef ?? ownRef;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value, ref]);

  return (
    <textarea
      ref={ref}
      rows={1}
      autoFocus={autoFocus}
      aria-label={label}
      placeholder={placeholder}
      value={value}
      enterKeyHint="send"
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
        e.preventDefault();
        onSubmit();
      }}
      className={
        "max-h-40 min-w-0 flex-1 resize-none bg-transparent py-1.5 text-[16px] leading-6 text-ink outline-none " +
        "placeholder:text-subtle focus-visible:outline-none md:text-[15px]"
      }
    />
  );
}
