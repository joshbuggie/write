"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { api } from "@/lib/api-client";
import { PROVIDER_PRESETS, presetFor, type AiConnection, type ProviderId } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";
import { ApiKeyField } from "./api-key-field";
import { keyProblem, toConnectionInput, type DraftConnection } from "./settings-draft";

type ConnectionFieldsProps = {
  connection: DraftConnection;
  /** The connection as last saved, if it was (for its key hint and the origin the key belongs to). */
  saved: AiConnection | undefined;
  onChange: (patch: Partial<DraftConnection>) => void;
};
type TestResult = { ok: boolean; message: string } | null;

const HINT = "text-[12.5px] leading-relaxed text-subtle";

/** "Connected · 4 models available", plus a warning when the chosen model isn't among them. */
function describeModels(models: string[], model: string): TestResult {
  if (models.length === 0) return { ok: true, message: "Connected. The server didn't list its models." };
  const listed = `Connected · ${models.length} ${models.length === 1 ? "model" : "models"} available`;
  if (model && !models.includes(model)) return { ok: false, message: `${listed}, but not “${model}”.` };
  return { ok: true, message: listed };
}

/**
 * One connection's form: name, provider preset, model, server URL and API key, plus "Test connection",
 * which asks the server (through write, with this form's values) for its models and fills the model
 * suggestions from the answer.
 */
export function ConnectionFields({ connection: draft, saved, onChange }: ConnectionFieldsProps) {
  const preset = presetFor(draft.provider);
  const urlHintId = useId();
  const modelsId = useId();
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  function changeProvider(id: ProviderId) {
    onChange({ provider: id, baseUrl: presetFor(id).baseUrl, model: "" });
    setModels([]);
    setResult(null);
  }

  async function test() {
    const problem = keyProblem(draft);
    if (problem) return setResult({ ok: false, message: problem });
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;
    setTesting(true);
    setResult(null);
    try {
      const input = { connection: toConnectionInput(draft) };
      const found = (await api.testConnection(input, { signal: controller.signal })).models;
      setModels(found);
      if (!draft.model.trim() && found[0]) onChange({ model: found[0] });
      setResult(describeModels(found, draft.model.trim() || (found[0] ?? "")));
    } catch (err) {
      if (controller.signal.aborted) return;
      setResult({ ok: false, message: err instanceof Error ? err.message : "The test failed." });
    } finally {
      if (inFlight.current === controller) setTesting(false);
    }
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
