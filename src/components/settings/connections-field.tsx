"use client";

import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { connectionName, newConnection, presetFor, type AiConnection } from "@/lib/ai/settings";
import { ConnectionFields } from "./connection-fields";
import { keepsSavedKey, keyHintLabel, type DraftConnection, type SettingsDraft } from "./settings-draft";

type ConnectionsFieldProps = {
  draft: SettingsDraft;
  /** The connections as last saved: their key hints, and the origins those keys belong to. */
  saved: AiConnection[];
  onChange: (patch: Partial<SettingsDraft>) => void;
  /** Edits one connection against the latest draft, so an answer arriving late can't undo newer edits. */
  onChangeConnection: (id: string, patch: Partial<DraftConnection>) => void;
};

/** Host and port only: enough to recognize a server in a one-line summary. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url || "no URL";
  }
}

/** "Ollama · llama3.1:8b · 192.168.1.20:11434", or "key ••a3F9" in place of the host for hosted APIs. */
function summary(c: DraftConnection, saved: AiConnection | undefined): string {
  const preset = presetFor(c.provider);
  const key = c.apiKey?.trim()
    ? "new key"
    : keepsSavedKey(c, saved)
      ? `key ${keyHintLabel(saved?.keyHint ?? "")}`
      : "no API key";
  const where = preset.needsKey ? key : hostOf(c.baseUrl);
  return [preset.label, c.model || "no model", where].join(" · ");
}

/**
 * The saved connections: one line each, the default marked, and an inline form to edit one. With more
 * than one, the prompt window gets a picker; the default is what it starts with. When a form closes,
 * focus moves to a control that is still there instead of falling to the dialog.
 */
export function ConnectionsField({ draft, saved, onChange, onChangeConnection }: ConnectionsFieldProps) {
  const { connections, defaultConnectionId } = draft;
  const [editing, setEditing] = useState<string | null>(null);
  const ids = useId();
  const editId = (id: string) => `${ids}-edit-${id}`;
  const addId = `${ids}-add`;
  const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());
  const savedById = (id: string) => saved.find((c) => c.id === id);

  function add() {
    const connection = newConnection();
    onChange({
      connections: [...connections, connection],
      defaultConnectionId: defaultConnectionId ?? connection.id,
    });
    setEditing(connection.id);
  }

  function remove(id: string) {
    const rest = connections.filter((c) => c.id !== id);
    const keepDefault = defaultConnectionId !== id && defaultConnectionId !== null;
    onChange({
      connections: rest,
      defaultConnectionId: keepDefault ? defaultConnectionId : (rest[0]?.id ?? null),
    });
    focusSoon(addId);
  }

  return (
    <div className="flex flex-col gap-2.5">
      {connections.length > 0 && (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
          {connections.map((c) => {
            const isDefault = c.id === defaultConnectionId;
            if (editing === c.id) {
              return (
                <li key={c.id} className="flex flex-col gap-3.5 bg-canvas px-3 py-3">
                  <ConnectionFields
                    connection={c}
                    saved={savedById(c.id)}
                    onChange={(patch) => onChangeConnection(c.id, patch)}
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Button size="sm" variant="ghost" onClick={() => remove(c.id)}>
                      <Trash2 aria-hidden strokeWidth={1.75} className="size-4" />
                      Delete
                    </Button>
                    <span className="flex-1" />
                    {!isDefault && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onChange({ defaultConnectionId: c.id })}
                      >
                        Make default
                      </Button>
                    )}
                    <Button
                      size="sm"
                      onClick={() => {
                        setEditing(null);
                        focusSoon(editId(c.id));
                      }}
                    >
                      Done
                    </Button>
                  </div>
                </li>
              );
            }
            return (
              <li key={c.id} className="flex items-center gap-3 py-2 pr-1.5 pl-3">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-[14px] text-ink">
                    <span className="truncate">{connectionName(c)}</span>
                    {isDefault && (
                      <span className="shrink-0 rounded bg-accent-soft px-1.5 py-0.5 text-[11.5px] text-accent">
                        Default
                      </span>
                    )}
                  </p>
                  <p className="truncate text-[12.5px] text-muted">{summary(c, savedById(c.id))}</p>
                </div>
                <IconButton
                  id={editId(c.id)}
                  label={`Edit ${connectionName(c)}`}
                  icon={Pencil}
                  onClick={() => setEditing(c.id)}
                />
              </li>
            );
          })}
        </ul>
      )}
      <div>
        <Button id={addId} size="sm" onClick={add}>
          <Plus aria-hidden strokeWidth={1.75} className="size-4" />
          Add connection
        </Button>
      </div>
    </div>
  );
}
