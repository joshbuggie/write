"use client";

import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { AiSettings } from "@/lib/ai/settings";
import { AiSettingsSection } from "./ai-settings-section";

type SettingsDialogProps = {
  initial: AiSettings;
  onSave: (next: AiSettings) => void;
  onClose: () => void;
};

/**
 * App settings, opened from the sidebar (or from the prompt window). Changes are a draft until Save, so
 * Cancel leaves everything as it was. Today the only section is the AI assistant. Mount it only while
 * open: the draft starts from the saved settings each time.
 */
export function SettingsDialog({ initial, onSave, onClose }: SettingsDialogProps) {
  const formId = useId();
  const toast = useToast();
  const [draft, setDraft] = useState(initial);
  const update = (patch: Partial<AiSettings>) => setDraft((d) => ({ ...d, ...patch }));

  function save(e: FormEvent) {
    e.preventDefault();
    onSave(draft);
    toast.show({ message: "Settings saved" });
    onClose();
  }

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Settings"
      description="Saved on your write server, in its config folder apart from your notes, so they apply on every device and a synced notes folder never carries your API keys."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form={formId}>
            Save
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={save}>
        <AiSettingsSection draft={draft} onChange={update} />
      </form>
    </Dialog>
  );
}
