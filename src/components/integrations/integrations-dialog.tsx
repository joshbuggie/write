"use client";

import { Plus } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { IntegrationTokenResponse } from "@/lib/api-contract";
import { IntegrationForm } from "./integration-form";
import { IntegrationRow } from "./integration-row";
import { TokenReveal } from "./token-reveal";
import { useIntegrations } from "./use-integrations";

type IntegrationsDialogProps = {
  /** Every folder in the library, for the folder checkboxes. */
  library: string[];
  /** False with WRITE_AUTH=off, when the rest of the API needs no token at all. */
  authEnabled: boolean;
  onClose: () => void;
};

/**
 * Agent harnesses that may read chosen folders (docs/design-decisions.md#d31): Turnstone, Hermes Agent or
 * any other client. Each gets its own token, shown once. Opened from the sidebar, apart from Settings,
 * because an integration is a door into the notes rather than a preference.
 */
export function IntegrationsDialog({ library, authEnabled, onClose }: IntegrationsDialogProps) {
  const ids = useId();
  const { items, loadError, create, update, remove, rotate } = useIntegrations();
  const [editing, setEditing] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<IntegrationTokenResponse | null>(null);
  const editButtonId = (id: string) => `${ids}-edit-${id}`;
  const addId = `${ids}-add`;
  const focusSoon = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.focus());

  const closeForm = (focusId: string) => {
    setEditing(null);
    focusSoon(focusId);
  };

  return (
    <Dialog
      open
      size="lg"
      onClose={onClose}
      title="Integrations"
      description="Agent harnesses such as Turnstone or Hermes Agent can read the folders you choose here, each with its own token. They can't change your notes."
      footer={<Button onClick={onClose}>Close</Button>}
    >
      {!authEnabled && (
        <p className="mb-3 rounded-md bg-warning-soft px-3 py-2 text-[13px] leading-relaxed text-ink">
          Sign-in is off, so anything that can reach write can read and change every note without a token.
          Folder limits only hold for harnesses that use their token. Turn sign-in on before connecting one.
        </p>
      )}
      {revealed ? (
        <TokenReveal
          integration={revealed.integration}
          token={revealed.token}
          onDone={() => {
            setRevealed(null);
            focusSoon(editButtonId(revealed.integration.id));
          }}
        />
      ) : loadError ? (
        <p role="alert" className="text-[14px] text-danger">
          {loadError}
        </p>
      ) : items === null ? (
        <Spinner />
      ) : (
        <div className="flex flex-col gap-2.5">
          {items.length === 0 && editing !== "new" && (
            <p className="text-[14px] text-muted">No integrations yet.</p>
          )}
          {(items.length > 0 || editing === "new") && (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line">
              {items.map((i) => (
                <IntegrationRow
                  key={i.id}
                  integration={i}
                  library={library}
                  editing={editing === i.id}
                  editButtonId={editButtonId(i.id)}
                  onEdit={() => setEditing(i.id)}
                  onDone={() => closeForm(editButtonId(i.id))}
                  onSave={(input) => update(i.id, input)}
                  onDelete={async () => {
                    await remove(i.id);
                    closeForm(addId);
                  }}
                  onRotate={async () => {
                    setRevealed(await rotate(i.id));
                    setEditing(null);
                  }}
                />
              ))}
              {editing === "new" && (
                <li>
                  <IntegrationForm
                    initial={{ name: "", kind: "turnstone", folders: [] }}
                    library={library}
                    submitLabel="Add and show token"
                    onSubmit={async (input) => {
                      setRevealed(await create(input));
                      setEditing(null);
                    }}
                    onCancel={() => closeForm(addId)}
                  />
                </li>
              )}
            </ul>
          )}
          {editing !== "new" && (
            <div>
              <Button id={addId} size="sm" onClick={() => setEditing("new")}>
                <Plus aria-hidden strokeWidth={1.75} className="size-4" />
                Add integration
              </Button>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
