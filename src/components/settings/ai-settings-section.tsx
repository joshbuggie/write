"use client";

import { useId } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { TextAreaField } from "@/components/ui/text-area-field";
import { DEFAULT_INSTRUCTIONS, type AiScope, type AiSettings } from "@/lib/ai/settings";
import { ConnectionsField } from "./connections-field";
import { QuickActionsField } from "./quick-actions-field";
import { SettingsGroup } from "./settings-group";
import { ShortcutField } from "./shortcut-field";

type AiSettingsSectionProps = { draft: AiSettings; onChange: (patch: Partial<AiSettings>) => void };

const SCOPES: { value: AiScope; label: string; hint: string }[] = [
  {
    value: "selection",
    label: "The selection",
    hint: "Or the paragraph at the cursor when nothing is selected.",
  },
  {
    value: "note",
    label: "The whole note",
    hint: "Better answers about the note, but slower on long notes.",
  },
];

/**
 * The AI assistant's settings. Switched off, it collapses to the switch alone: the feature's whole
 * footprint is this one row. The instructions (system prompt) are shown in full, not hidden behind an
 * "advanced" toggle, because they go out with every request.
 */
export function AiSettingsSection({ draft, onChange }: AiSettingsSectionProps) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId}>
      <div className="flex items-start gap-4">
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-[15px] font-semibold tracking-tight">
            AI assistant
          </h3>
          <p className="mt-0.5 text-[13px] leading-relaxed text-muted">
            Ask a model to edit, rewrite or answer questions about the text at your cursor. While it’s off
            there’s no AI button or shortcut, and nothing is sent anywhere.
          </p>
        </div>
        <Switch
          checked={draft.enabled}
          onChange={(enabled) => onChange({ enabled })}
          label="AI assistant"
          labelledBy={headingId}
        />
      </div>

      {draft.enabled && (
        <>
          <SettingsGroup
            title="Connections"
            description="Hosted APIs or inference servers on your network. write sends note text only when you run a request, and only to the connection you picked. Save more than one to switch between them in the prompt window."
          >
            <ConnectionsField draft={draft} onChange={onChange} />
          </SettingsGroup>

          <SettingsGroup title="Prompt window">
            <ShortcutField value={draft.shortcut} onChange={(shortcut) => onChange({ shortcut })} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1.5 text-[13px] font-medium text-muted">Send with each request</legend>
              {SCOPES.map((scope) => (
                <label key={scope.value} className="flex cursor-pointer items-start gap-2.5">
                  <input
                    type="radio"
                    name="ai-scope"
                    checked={draft.defaultScope === scope.value}
                    onChange={() => onChange({ defaultScope: scope.value })}
                    className="mt-[3px] size-4 shrink-0 accent-accent"
                  />
                  <span className="min-w-0">
                    <span className="block text-[14px] text-ink">{scope.label}</span>
                    <span className="block text-[13px] text-muted">{scope.hint}</span>
                  </span>
                </label>
              ))}
              <p className="text-[12.5px] text-subtle">
                You can switch for a single request in the prompt window.
              </p>
            </fieldset>
          </SettingsGroup>

          <SettingsGroup title="Instructions">
            <TextAreaField
              label="Sent before your note text on every request (system prompt)"
              rows={7}
              spellCheck={false}
              value={draft.instructions}
              onChange={(e) => onChange({ instructions: e.target.value })}
              className="font-mono text-[13px]! max-md:text-[16px]!"
              action={
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={draft.instructions === DEFAULT_INSTRUCTIONS}
                  onClick={() => onChange({ instructions: DEFAULT_INSTRUCTIONS })}
                >
                  Reset
                </Button>
              }
              hint="Set the tone, language or format you want. The prompt window shows exactly what is sent under “What gets sent”."
            />
          </SettingsGroup>

          <SettingsGroup
            title="Quick actions"
            description="One-click requests in the prompt window. Each prompt is sent as written, after the instructions."
          >
            <QuickActionsField
              actions={draft.quickActions}
              onChange={(quickActions) => onChange({ quickActions })}
            />
          </SettingsGroup>
        </>
      )}
    </section>
  );
}
