"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api-client";
import type { ConnectionInput } from "@/lib/api-contract";
import { PROVIDER_PRESETS, presetFor, type AiConnection, type ProviderId } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import { ApiKeyField } from "./api-key-field";
import { connectionIdentity, runConnectionTest, type TestResult } from "./connection-test";
import { keyProblem, type DraftConnection } from "./settings-draft";

type ConnectionFieldsProps = {
  connection: DraftConnection;
  /** The connection as last saved, if it was (for its key hint and the origin the key belongs to). */
  saved: AiConnection | undefined;
  onChange: (patch: Partial<DraftConnection>) => void;
};
/** The last test's answer, for the connection (see connectionIdentity) it was about. */
type Tested = { identity: string; models: string[]; result: TestResult };

const HINT = "text-[12.5px] leading-relaxed text-subtle";

/**
 * One connection's form: name, provider preset, model, server URL and API key, plus "Test connection",
 * which asks the server (through write, with this form's values) for its models and fills the model
 * suggestions from the answer.
 */
export function ConnectionFields({ connection: draft, saved, onChange }: ConnectionFieldsProps) {
  const preset = presetFor(draft.provider);
  const urlHintId = useId();
  const modelsId = useId();
  const [testing, setTesting] = useState(false);
  const [tested, setTested] = useState<Tested | null>(null);
  const inFlight = useRef<AbortController | null>(null);
  // The form as it is now, for a test's answer to be judged against when it arrives.
  const latest = useRef(draft);
  const identity = connectionIdentity(draft);
  // Suggestions and the result only show for the connection they came from.
  const shown = tested?.identity === identity ? tested : null;
  const models = shown?.models ?? [];
  const result = shown?.result ?? null;

  useLayoutEffect(() => {
    latest.current = draft;
  });
  // A test of a provider, URL or key the form no longer has is abandoned (and on unmount).
  useEffect(() => () => inFlight.current?.abort(), [identity]);

  function changeProvider(id: ProviderId) {
    onChange({ provider: id, baseUrl: presetFor(id).baseUrl, model: "" });
  }

  async function test() {
    const problem = keyProblem(draft);
    if (problem) return setTested({ identity, models: [], result: { ok: false, message: problem } });
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setTesting(true);
    setTested(null);
    const fetchModels = async (connection: ConnectionInput) =>
      (await api.testConnection({ connection }, { signal: controller.signal })).models;
    const outcome = await runConnectionTest(draft, fetchModels, () => latest.current);
    if (inFlight.current === controller) setTesting(false);
    if (!outcome || controller.signal.aborted) return;
    if (outcome.autofill) onChange({ model: outcome.autofill });
    setTested({ identity, models: outcome.models, result: outcome.result });
  }

  return (
    <>
      <TextField
        label="Name"
        autoFocus
        placeholder={preset.label}
        value={draft.name}
        onChange={(e) => onChange({ name: e.target.value })}
      />
      <div className="grid gap-3.5 md:grid-cols-2">
        <SelectField
          label="Provider"
          value={draft.provider}
          onChange={(e) => changeProvider(e.target.value as ProviderId)}
          options={PROVIDER_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
        />
        <TextField
          label="Model"
          list={modelsId}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={preset.modelPlaceholder}
          value={draft.model}
          onChange={(e) => onChange({ model: e.target.value })}
        />
        <datalist id={modelsId}>
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </div>

      <div className="flex flex-col gap-1.5">
        <TextField
          label="Server URL"
          type="url"
          inputMode="url"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder={preset.baseUrl || "http://192.168.1.20:8080/v1"}
          value={draft.baseUrl}
          aria-describedby={urlHintId}
          onChange={(e) => onChange({ baseUrl: e.target.value })}
          className="font-mono md:text-[13px]!"
        />
        <p id={urlHintId} className={HINT}>
          Requests come from the write server, so <span className="font-mono">localhost</span> means the
          machine write runs on (in Docker, the container). Use a LAN address to reach another computer.
        </p>
      </div>

      <ApiKeyField connection={draft} saved={saved} onChange={onChange} />

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" pending={testing} onClick={() => void test()}>
          Test connection
        </Button>
        {/* Always mounted, so screen readers announce the result when it appears. */}
        <p
          role="status"
          className={cn("flex items-center gap-1.5 text-[13px]", result?.ok ? "text-success" : "text-danger")}
        >
          {result?.ok && <Check aria-hidden strokeWidth={2} className="size-4 shrink-0" />}
          {result && !result.ok && (
            <TriangleAlert aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
          )}
          {result?.message}
        </p>
      </div>
    </>
  );
}
