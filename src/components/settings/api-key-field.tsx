"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import type { AiConnection } from "@/lib/ai/settings";
import { presetFor } from "@/lib/ai/settings";
import {
  keepsSavedKey,
  keyHintLabel,
  keyProblem,
  originOf,
  withScheme,
  type DraftConnection,
} from "./settings-draft";

type ApiKeyFieldProps = {
  connection: DraftConnection;
  /** The connection as last saved, if it was: its key hint and the origin the key belongs to. */
  saved: AiConnection | undefined;
  onChange: (patch: Partial<DraftConnection>) => void;
};

const HINT = "text-[12.5px] leading-relaxed text-subtle";

/**
 * The API key: write-only. A saved key shows as a hint (its last four characters) with Replace and Remove; a new
 * one is typed in a password field and leaves the browser only on Save or Test. A key saved for another
 * address is not reused (the server wouldn't send it there), so the field asks for it again.
 */
export function ApiKeyField({ connection, saved, onChange }: ApiKeyFieldProps) {
  const preset = presetFor(connection.provider);
  const hintId = useId();
  const [replacing, setReplacing] = useState(false);
  const kept = keepsSavedKey(connection, saved);

  if (kept && !replacing) {
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-muted">API key</span>
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
            {saved?.keyHint?.startsWith("•") ? "••••••••" : `•••• ${saved?.keyHint}`}
            <span className="ml-2 font-sans text-muted">Saved</span>
          </span>
          <Button size="sm" onClick={() => setReplacing(true)}>
            Replace
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onChange({ clearKey: true, apiKey: undefined })}>
            Remove
          </Button>
        </div>
        <p className={HINT}>Kept on the write server and never sent back to the browser.</p>
      </div>
    );
  }

  const movedKey =
    saved?.keyHint &&
    !connection.clearKey &&
    originOf(withScheme(connection.baseUrl)) !== originOf(saved.baseUrl);
  const problem = keyProblem(connection);
  let hint = "Kept on the write server and never sent back to the browser.";
  if (connection.clearKey) hint = "The saved key will be removed when you save.";
  else if (movedKey) {
    hint = `The saved key (${keyHintLabel(saved?.keyHint ?? "")}) is only sent to ${originOf(saved.baseUrl) ?? "its old address"}. Enter it again to use it with this address.`;
  }

  return (
    <div className="flex flex-col gap-1.5">
      <TextField
        label={preset.needsKey ? "API key" : "API key (optional)"}
        type="password"
        autoComplete="off"
        spellCheck={false}
        autoFocus={replacing}
        placeholder={preset.needsKey ? "Paste your API key" : "Not needed for most local servers"}
        value={connection.apiKey ?? ""}
        aria-describedby={hintId}
        onChange={(e) => onChange({ apiKey: e.target.value })}
      />
      <div className="flex items-start gap-2">
        <p id={hintId} className={`${HINT} min-w-0 flex-1 ${problem ? "text-danger" : ""}`}>
          {problem ?? hint}
        </p>
        {(replacing || connection.clearKey) && saved?.keyHint && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setReplacing(false);
              onChange({ clearKey: false, apiKey: undefined });
            }}
          >
            Keep saved key
          </Button>
        )}
      </div>
    </div>
  );
}
