"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextAreaField } from "@/components/ui/text-area-field";
import { TextField } from "@/components/ui/text-field";
import { DEFAULT_QUICK_ACTIONS, type ApplyMode, type QuickAction } from "@/lib/ai/settings";

type QuickActionsFieldProps = { actions: QuickAction[]; onChange: (actions: QuickAction[]) => void };

const APPLY_LABEL: Record<ApplyMode, string> = { replace: "Replaces", insert: "Inserts below" };
const APPLY_OPTIONS = [
  { value: "replace", label: "Replace the text (Replace is the main button)" },
  { value: "insert", label: "Insert below the text (Insert is the main button)" },
];

/**
 * The quick actions list: each one a name, the exact prompt it sends, and where its result goes. When an
 * editor row closes, focus moves to a control that is still there instead of falling to the dialog.
 */
export function QuickActionsField({ actions, onChange }: QuickActionsFieldProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const ids = useId();
  const editId = (id: string) => `${ids}-edit-${id}`;
  const addId = `${ids}-add`;
  const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const update = (id: string, patch: Partial<QuickAction>) =>
    onChange(actions.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  function add() {
    const action: QuickAction = {
      id: `action-${Date.now().toString(36)}`,
      label: "",
      prompt: "",
      apply: "replace",
    };
    onChange([...actions, action]);
    setEditing(action.id);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {actions.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {actions.map((action) =>
            editing === action.id ? (
              <li key={action.id} className="flex flex-col gap-3 bg-canvas px-3 py-3">
                <TextField
                  label="Name"
                  autoFocus
                  placeholder="Translate to Spanish"
                  value={action.label}
                  onChange={(e) => update(action.id, { label: e.target.value })}
                />
                <TextAreaField
                  label="Prompt"
                  rows={3}
                  placeholder="Translate this text into Spanish. Keep the formatting."
                  value={action.prompt}
                  onChange={(e) => update(action.id, { prompt: e.target.value })}
                />
                <SelectField
                  label="Result"
                  value={action.apply}
                  options={APPLY_OPTIONS}
                  onChange={(e) => update(action.id, { apply: e.target.value as ApplyMode })}
                />
                <div className="flex items-center justify-between gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onChange(actions.filter((a) => a.id !== action.id));
                      focusSoon(addId);
                    }}
                  >
                    <Trash2 aria-hidden strokeWidth={1.75} className="size-4" />
                    Delete
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setEditing(null);
                      focusSoon(editId(action.id));
                    }}
                    disabled={!action.label.trim() || !action.prompt.trim()}
                  >
                    Done
                  </Button>
                </div>
              </li>
            ) : (
              <li key={action.id} className="flex items-center gap-3 py-2 pr-1.5 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] text-ink">{action.label || "Untitled action"}</p>
                  <p className="truncate text-[12.5px] text-muted">{action.prompt}</p>
                </div>
                <span className="shrink-0 rounded bg-hover px-1.5 py-0.5 text-[11.5px] text-muted max-md:hidden">
                  {APPLY_LABEL[action.apply]}
                </span>
                <IconButton
                  id={editId(action.id)}
                  label={`Edit ${action.label || "untitled action"}`}
                  icon={Pencil}
                  onClick={() => setEditing(action.id)}
                />
              </li>
            ),
          )}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <Button id={addId} size="sm" onClick={add}>
          <Plus aria-hidden strokeWidth={1.75} className="size-4" />
          Add quick action
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_QUICK_ACTIONS)}>
          Restore defaults
        </Button>
      </div>
    </div>
  );
}
