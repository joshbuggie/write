"use client";

import { useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import { cn } from "@/lib/cn";
import { validateName } from "@/lib/names";

type TitleInputProps = {
  /** Current on-disk name. The note screen remounts after a rename, so this is the initial value. */
  name: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Performs the rename; resolves with an error message to show, or null on success. */
  onRename: (newName: string) => Promise<string | null>;
  /** Moves focus to the start of the body (Enter, or ArrowDown at the end of the title). */
  onFocusBody: () => void;
};

/**
 * The note title, which IS the file name. Validated live with the same rules the server uses, and
 * committed on blur or Enter (Escape reverts), so renaming is just editing the title.
 */
export function TitleInput({ name, inputRef, onRename, onFocusBody }: TitleInputProps) {
  const errorId = useId();
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const committing = useRef(false);

  function change(next: string) {
    setValue(next);
    const check = validateName(next, "note");
    // An empty title isn't flagged while typing; committing it simply reverts.
    setError(check.ok || !next.trim() ? null : check.message);
  }

  async function commit() {
    if (committing.current) return;
    const check = validateName(value, "note");
    if (!value.trim() || (check.ok && check.name === name)) {
      setValue(name);
      setError(null);
      return;
    }
    if (!check.ok) {
      setError(check.message);
      return;
    }
    committing.current = true;
    const failure = await onRename(check.name);
    committing.current = false;
    if (failure) setError(failure);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const el = e.currentTarget;
    const caretAtEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
    if (e.key === "Escape") {
      setValue(name);
      setError(null);
    } else if (e.key === "Enter" || (e.key === "ArrowDown" && caretAtEnd)) {
      e.preventDefault();
      if (e.key === "Enter" && error) return;
      onFocusBody(); // blurring the title commits it
    }
  }

  return (
    <div className="pt-6 md:pt-14">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => change(e.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        aria-label="Note title"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        placeholder="Title"
        enterKeyHint="next"
        autoCapitalize="sentences"
        autoComplete="off"
        spellCheck
        className={cn(
          "block w-full min-w-0 bg-transparent text-ink outline-none placeholder:text-subtle",
          "text-[26px] leading-[32px] font-[650] tracking-[-0.01em]",
          "md:text-[32px] md:leading-[40px] xl:text-[34px] xl:leading-[42px]",
        )}
      />
      {/* Always mounted: screen readers only announce changes to a live region that already exists. */}
      <p id={errorId} aria-live="polite" className="mt-1 text-[13px] text-danger empty:hidden">
        {error}
      </p>
    </div>
  );
}
