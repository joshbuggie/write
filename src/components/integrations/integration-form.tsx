"use client";

import { useId, useState, type FormEvent } from "react";
import type React from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import type { IntegrationRequest } from "@/lib/api-contract";
import {
  checkIntegrationName,
  DEFAULT_LAUNCHER,
  INTEGRATION_KINDS,
  launcherProblem,
  type IntegrationKind,
  type LauncherView,
} from "@/lib/integrations";
import { folderChoices, toggleFolder } from "./integration-summary";
import { LauncherFields, type LauncherDraft } from "./launcher-fields";

type IntegrationFormProps = {
  initial: IntegrationRequest;
  /** The saved integration's id and launcher, for "Test connection" with its saved key; null when new. */
  integrationId: string | null;
  savedLauncher: LauncherView | null;
  /** Every folder in the library, for the checkboxes. */
  library: string[];
  submitLabel: string;
  /** Saves on the server; throws (ApiError) with a message to show when that fails. */
  onSubmit: (input: IntegrationRequest) => Promise<void>;
  onCancel: () => void;
  /** Extra buttons on the left of the button row (Delete, New token) when editing. */
  actions?: React.ReactNode;
};

/**
 * Name, kind and folders for one integration. The folders are the whole of what its token can read, so
 * they are ticked one by one; there is no "every folder" switch (docs/design-decisions.md#d31).
 */
export function IntegrationForm(props: IntegrationFormProps) {
  const { initial, library, submitLabel, onSubmit, onCancel, actions, integrationId, savedLauncher } = props;
  const ids = useId();
  const [name, setName] = useState(initial.name);
  const [kind, setKind] = useState<IntegrationKind>(initial.kind);
  const [folders, setFolders] = useState(initial.folders);
  // The saved key never comes to the browser: an empty key field means "keep it" (see mergeLauncher).
  const [launcher, setLauncher] = useState<LauncherDraft>(() =>
    savedLauncher
      ? {
          url: savedLauncher.url,
          ca: savedLauncher.ca,
          turnstoneMode: savedLauncher.turnstoneMode,
          mcpServerName: savedLauncher.mcpServerName,
          enabled: true,
        }
      : { ...DEFAULT_LAUNCHER, enabled: false },
  );
  const [nameError, setNameError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    e.stopPropagation();
    const checked = checkIntegrationName(name);
    if (!checked.ok) return setNameError(checked.message);
    const { enabled, ...launcherInput } = launcher;
    const problem = enabled ? launcherProblem(launcherInput) : null;
    if (problem) return setError(problem);
    setPending(true);
    setError(null);
    try {
      await onSubmit({ name: checked.name, kind, folders, launcher: enabled ? launcherInput : null });
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save the integration.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form noValidate onSubmit={(e) => void submit(e)} className="flex flex-col gap-3.5 bg-canvas px-3 py-3">
      <div className="grid gap-3.5 md:grid-cols-2">
        <TextField
          label="Name"
          value={name}
          error={nameError}
          autoComplete="off"
          onChange={(e) => {
            setName(e.target.value);
            setNameError(null);
          }}
        />
        <SelectField
          label="Harness"
          value={kind}
          options={INTEGRATION_KINDS.map((k) => ({ value: k.id, label: k.label }))}
          onChange={(e) => setKind(e.target.value as IntegrationKind)}
        />
      </div>
      <fieldset className="flex min-w-0 flex-col gap-1.5">
        <legend className="text-[13px] font-medium text-muted">Folders it can read</legend>
        <ul className="mt-1.5 flex max-h-48 flex-col gap-px overflow-y-auto rounded-md border border-line bg-surface py-1">
          {folderChoices(library, folders).map((f) => {
            const id = `${ids}-${f.name}`;
            return (
              <li key={f.name} className="flex items-center gap-2.5 px-2.5 py-1 pointer-coarse:py-2">
                <input
                  id={id}
                  type="checkbox"
                  className="size-4 shrink-0 accent-accent"
                  checked={folders.some((c) => c === f.name)}
                  onChange={(e) => setFolders((current) => toggleFolder(current, f.name, e.target.checked))}
                />
                <label htmlFor={id} className="min-w-0 truncate text-[14px] text-ink">
                  {f.name}
                  {f.missing && <span className="text-muted"> (no longer in your library)</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-[12.5px] text-muted">Notes in other folders stay invisible to it.</p>
      </fieldset>
      <LauncherFields
        kind={kind}
        draft={launcher}
        saved={savedLauncher}
        integrationId={integrationId}
        onChange={(patch) => setLauncher((l) => ({ ...l, ...patch }))}
      />
      {error && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {actions && <div className="flex gap-1">{actions}</div>}
        <div className="ml-auto flex gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" type="submit" pending={pending}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}
