"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";

type SecretFieldProps = {
  label: string;
  /** The saved key's hint, or null when none is saved (or it won't be kept, e.g. the address moved). */
  savedHint: string | null;
  value: string;
  onChange: (value: string) => void;
  /** Removes the saved key on Save. */
  onClear: () => void;
  placeholder?: string;
};

/**
 * A write-only key (docs/design-decisions.md#d31, like the AI keys in #d29): a saved one shows only its
 * last characters, with Replace and Remove; a new one is typed in a password field.
 */
export function SecretField({ label, savedHint, value, onChange, onClear, placeholder }: SecretFieldProps) {
  const [replacing, setReplacing] = useState(false);
  if (savedHint && !replacing && !value) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">{label}</span>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
            {savedHint.startsWith("•") ? "••••••••" : `•••• ${savedHint}`}
            <span className="ml-2 font-sans text-muted">Saved</span>
          </span>
          <Button size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={onClear}>
            Remove
          </Button>
        </div>
      </div>
    );
  }
  return (
    <TextField
      label={label}
      type="password"
      autoComplete="off"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
