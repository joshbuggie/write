"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextAreaField } from "@/components/ui/text-area-field";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api-client";
import {
  launcherProblem,
  type IntegrationKind,
  type LauncherInput,
  type LauncherView,
} from "@/lib/integrations";
import { SecretField } from "./secret-field";

/** The launcher as the form edits it: off, or the input the server takes. */
export type LauncherDraft = LauncherInput & { enabled: boolean };

type LauncherFieldsProps = {
  kind: IntegrationKind;
  draft: LauncherDraft;
  saved: LauncherView | null;
  integrationId: string | null;
  onChange: (patch: Partial<LauncherDraft>) => void;
};

const WHERE: Record<IntegrationKind, { label: string; placeholder: string; key: string }> = {
  turnstone: {
    label: "Turnstone address",
    placeholder: "https://turnstone.local",
    key: "Turnstone API token",
  },
  hermes: { label: "Hermes API address", placeholder: "http://hermes.local:8642/v1", key: "Hermes API key" },
  other: {
    label: "Webhook URL",
    placeholder: "https://automation.local/hooks/write",
    key: "Secret (optional)",
  },
};

const originOf = (url: string) => {
  try {
    return new URL(url.trim()).origin;
  } catch {
    return null;
  }
};

/**
 * How write starts jobs in the harness, for "Send to…" on a note (docs/design-decisions.md#d31). Optional:
 * without it the harness is started from its own UI and still reads and proposes through MCP.
 */
export function LauncherFields({ kind, draft, saved, integrationId, onChange }: LauncherFieldsProps) {
  const enabledId = useId();
  const modeHintId = useId();
  const [test, setTest] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const where = WHERE[kind];
  // A saved key is only kept for the same server, so it only shows while the address stays on it.
  const keptHint =
    saved?.keyHint && !draft.clearKey && originOf(draft.url) === originOf(saved.url) ? saved.keyHint : null;

  async function runTest() {
    const problem = launcherProblem(draft);
    if (problem) return setTest({ ok: false, text: problem });
    setTesting(true);
    try {
      const { message } = await api.testLauncher({ integrationId, kind, launcher: draft });
      setTest({ ok: true, text: message });
    } catch (err) {
      setTest({ ok: false, text: err instanceof Error ? err.message : "Couldn't test the connection." });
    } finally {
      setTesting(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-md border border-line px-3 py-2.5">
      <div className="flex items-center gap-2">
        <input
          id={enabledId}
          type="checkbox"
          className="size-4 accent-accent"
          checked={draft.enabled}
          onChange={(e) => onChange({ enabled: e.target.checked })}
        />
        <label htmlFor={enabledId} className="text-[14px] text-ink">
          Start jobs from write (“Send to…” on a note)
        </label>
      </div>
      {draft.enabled && (
        <>
          <TextField
            label={where.label}
            value={draft.url}
            placeholder={where.placeholder}
            autoComplete="off"
            onChange={(e) => onChange({ url: e.target.value })}
          />
          <SecretField
            label={where.key}
            savedHint={keptHint}
            value={draft.key ?? ""}
            onChange={(key) => onChange({ key, clearKey: false })}
            onClear={() => onChange({ key: "", clearKey: true })}
          />
          {kind === "turnstone" && (
            <div className="grid gap-3 md:grid-cols-2">
              <SelectField
                label="Start as"
                aria-describedby={modeHintId}
                value={draft.turnstoneMode}
                options={[
                  { value: "coordinator", label: "Coordinator (several agents)" },
                  { value: "workstream", label: "Single workstream" },
                ]}
                onChange={(e) =>
                  onChange({ turnstoneMode: e.target.value as LauncherDraft["turnstoneMode"] })
                }
              />
              <TextField
                label="write's MCP server name in Turnstone"
                value={draft.mcpServerName}
                onChange={(e) => onChange({ mcpServerName: e.target.value })}
              />
            </div>
          )}
          {kind === "turnstone" && (
            <p id={modeHintId} className="-mt-1 text-[12.5px] leading-relaxed text-muted">
              {draft.turnstoneMode === "coordinator"
                ? "A coordinator runs several agents, but Turnstone asks you to approve write's tools in it (choose “always” once). A single workstream needs no approvals."
                : "A single workstream runs one agent, with write's tools approved in advance."}
            </p>
          )}
          <details className="text-[13px] text-muted">
            <summary className="cursor-pointer">Private certificate?</summary>
            <div className="mt-2">
              <TextAreaField
                label="Trusted certificate authority (PEM)"
                rows={4}
                value={draft.ca}
                placeholder="-----BEGIN CERTIFICATE-----"
                hint="For a server whose certificate your own authority signed (Caddy's local CA, say). With one set, write trusts what it signed for this server only, and doesn't check the host name."
                onChange={(e) => onChange({ ca: e.target.value })}
              />
            </div>
          </details>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" pending={testing} onClick={() => void runTest()}>
              Test connection
            </Button>
            {test && (
              <span role="status" className={test.ok ? "text-[13px] text-ink" : "text-[13px] text-danger"}>
                {test.text}
              </span>
            )}
          </div>
        </>
      )}
    </fieldset>
  );
}
