"use client";

import { Check, TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { SelectField } from "@/components/ui/select-field";
import { TextField } from "@/components/ui/text-field";
import { MOCK_MODELS } from "@/lib/ai/mock/models";
import { PROVIDER_PRESETS, presetFor, type AiConnection, type ProviderId } from "@/lib/ai/settings";
import { cn } from "@/lib/cn";

type ConnectionFieldsProps = {
  connection: AiConnection;
  onChange: (patch: Partial<AiConnection>) => void;
};
type TestResult = { ok: boolean; message: string } | null;

const HINT = "text-[12.5px] leading-relaxed text-subtle";

/**
 * One connection's form: name, provider preset, model, server URL and API key, plus "Test connection".
 * The key is write-only: once saved, only its last four characters are ever shown again.
 */
export function ConnectionFields({ connection: draft, onChange }: ConnectionFieldsProps) {
  const preset = presetFor(draft.provider);
  const urlHintId = useId();
  const keyHintId = useId();
  const modelsId = useId();
  const [editingKey, setEditingKey] = useState(draft.keyHint === null);
  const [focusKey, setFocusKey] = useState(false); // after Replace or Remove, the new field takes focus
  const [key, setKey] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult>(null);

  function changeProvider(id: ProviderId) {
    onChange({ provider: id, baseUrl: presetFor(id).baseUrl, model: "" });
    setModels([]);
    setResult(null);
  }

  // MOCKUP: pretends to reach the server. The real one calls it through the write server and lists models.
  function test() {
    setTesting(true);
    setResult(null);
    setTimeout(() => {
      setTesting(false);
      if (!/^https?:\/\/\S+$/.test(draft.baseUrl.trim())) {
        setResult({ ok: false, message: "Enter a URL that starts with http:// or https://." });
      } else if (preset.needsKey && !draft.keyHint) {
        setResult({ ok: false, message: `${preset.label} needs an API key.` });
      } else {
        const found = MOCK_MODELS[draft.provider];
        setModels(found);
        setResult({ ok: true, message: `Connected · ${found.length} models available` });
      }
    }, 700);
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
          machine write runs on. Use its LAN address to reach a server on another computer.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {editingKey || !draft.keyHint ? (
          <TextField
            label={preset.needsKey ? "API key" : "API key (optional)"}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={preset.needsKey ? "Paste your API key" : "Not needed for most local servers"}
            autoFocus={focusKey}
            value={key}
            aria-describedby={keyHintId}
            onChange={(e) => {
              setKey(e.target.value);
              onChange({ keyHint: e.target.value ? e.target.value.slice(-4) : null });
            }}
          />
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium text-muted">API key</span>
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">
                •••• {draft.keyHint}
                <span className="ml-2 font-sans text-muted">Saved</span>
              </span>
              <Button
                size="sm"
                onClick={() => {
                  setEditingKey(true);
                  setFocusKey(true);
                }}
              >
                Replace
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange({ keyHint: null });
                  setEditingKey(true);
                  setFocusKey(true);
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        )}
        <p id={keyHintId} className={HINT}>
          Kept on the write server and never sent back to the browser.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" pending={testing} onClick={test}>
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
