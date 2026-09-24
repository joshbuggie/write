"use client";

import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import type { SaveSettingsRequest } from "@/lib/api-contract";
import { connectionName, type AiSettings } from "@/lib/ai/settings";
import { AccountSection } from "./account-section";
import { AiSettingsSection } from "./ai-settings-section";
import { keyProblem, toSaveRequest, type DraftConnection, type SettingsDraft } from "./settings-draft";

type SettingsDialogProps = {
  initial: AiSettings;
  /** The signed-in account; null while sign-in is off, which hides the Account section. */
  username: string | null;
  /** Saves on the server; throws (ApiError) with a message to show when that fails. */
  onSave: (next: SaveSettingsRequest["ai"]) => Promise<void>;
  onClose: () => void;
};

/**
 * App settings, opened from the sidebar (or from the prompt window). Changes are a draft until Save, so
 * Cancel leaves everything as it was, and a failed save keeps the dialog open with the reason. Mount it
 * only while open: the draft starts from the saved settings. The Account section sits outside that form,
 * with its own button: a password change is saved at once, never held in the draft.
 */
export function SettingsDialog({ initial, username, onSave, onClose }: SettingsDialogProps) {
  const formId = useId();
  const toast = useToast();
  const [draft, setDraft] = useState<SettingsDraft>(initial);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const update = (patch: Partial<SettingsDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // Applied to the latest draft, so a slow "Test connection" filling in the model can't undo later typing.
  const updateConnection = (id: string, patch: Partial<DraftConnection>) =>
    setDraft((d) => ({
      ...d,
      connections: d.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    }));

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [error]);

  async function save(e: FormEvent) {
    e.preventDefault();
    const bad = draft.connections.find((c) => keyProblem(c));
    if (bad) return setError(`${connectionName(bad)}: ${keyProblem(bad)}`);
    setPending(true);
    setError(null);
    try {
      await onSave(toSaveRequest(draft));
      toast.show({ message: "Settings saved" });
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't save the settings.");
    } finally {
      setPending(false);
    }
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
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} pending={pending}>
            Save
          </Button>
        </>
      }
    >
      {username !== null && <AccountSection username={username} />}
      <form id={formId} noValidate onSubmit={(e) => void save(e)}>
        <AiSettingsSection
          draft={draft}
          savedConnections={initial.connections}
          onChange={update}
          onChangeConnection={updateConnection}
        />
        {error && (
          <p ref={errorRef} role="alert" className="mt-4 text-[14px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
