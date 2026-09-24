"use client";

import { KeyRound, Pencil, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, IconButton } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/dialog";
import type { IntegrationRequest } from "@/lib/api-contract";
import type { IntegrationView } from "@/lib/integrations";
import { IntegrationForm } from "./integration-form";
import { lastUsedLabel, summarizeIntegration } from "./integration-summary";

type IntegrationRowProps = {
  integration: IntegrationView;
  library: string[];
  editing: boolean;
  /** The id of this row's Edit button, so focus can come back to it when the form closes. */
  editButtonId: string;
  onEdit: () => void;
  onDone: () => void;
  onSave: (input: IntegrationRequest) => Promise<void>;
  onDelete: () => Promise<void>;
  onRotate: () => Promise<void>;
};

/**
 * One integration: a summary line, or its form while editing. Deleting it and replacing its token both
 * cut the harness off at once, so each asks first.
 */
export function IntegrationRow(props: IntegrationRowProps) {
  const { integration: i, library, editing, editButtonId, onEdit, onDone } = props;
  const [confirm, setConfirm] = useState<"delete" | "rotate" | null>(null);

  const dialogs = (
    <>
      <ConfirmDialog
        open={confirm === "delete"}
        onClose={() => setConfirm(null)}
        onConfirm={props.onDelete}
        title={`Delete ${i.name}?`}
        description="Its token stops working at once. Your notes aren't touched."
        confirmLabel="Delete"
        destructive
      />
      <ConfirmDialog
        open={confirm === "rotate"}
        onClose={() => setConfirm(null)}
        onConfirm={props.onRotate}
        title={`Make a new token for ${i.name}?`}
        description="The current token stops working at once, so the harness needs the new one."
        confirmLabel="Make new token"
      />
    </>
  );

  if (editing) {
    return (
      <li>
        <IntegrationForm
          initial={{ name: i.name, kind: i.kind, folders: i.folders }}
          library={library}
          submitLabel="Save"
          onSubmit={async (input) => {
            await props.onSave(input);
            onDone();
          }}
          onCancel={onDone}
          actions={
            <>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("delete")}>
                <Trash2 aria-hidden strokeWidth={1.75} className="size-4" />
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm("rotate")}>
                <KeyRound aria-hidden strokeWidth={1.75} className="size-4" />
                New token
              </Button>
            </>
          }
        />
        {dialogs}
      </li>
    );
  }

  return (
    <li className="flex items-center gap-3 py-2 pr-1.5 pl-3">
      <div className="min-w-0 flex-1">
        <p className="truncate text-[14px] text-ink">{i.name}</p>
        <p className="truncate text-[12.5px] text-muted">{summarizeIntegration(i)}</p>
        <p className="truncate text-[12.5px] text-subtle">{lastUsedLabel(i.lastUsedAt)}</p>
      </div>
      <IconButton id={editButtonId} label={`Edit ${i.name}`} icon={Pencil} onClick={onEdit} />
    </li>
  );
}
