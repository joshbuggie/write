"use client";

import { useId, useMemo, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SelectField } from "@/components/ui/select-field";
import { TextAreaField } from "@/components/ui/text-area-field";
import type { JobView } from "@/lib/api-contract";
import { api } from "@/lib/api-client";
import type { SendTarget } from "@/lib/launch/types";
import { bodySections } from "@/lib/proposals/review";
import type { NoteRef } from "@/lib/types";

type SendDialogProps = {
  noteRef: NoteRef;
  /** The note's text, for the list of sections to limit the job to. */
  content: string;
  targets: SendTarget[];
  /** Saves pending edits first, so the harness reads the latest text; throws when that fails. */
  flush: () => Promise<void>;
  onSent: (job: JobView) => void;
  onClose: () => void;
};

const headingText = (h: string) => h.replace(/^#+\s*/, "").replace(/\s+#+$/, "");

/**
 * "Send to…" (docs/design-decisions.md#d31): asks a harness to work on this note. By default it continues
 * the harness's last conversation about the note, so it remembers what was accepted before; the changes
 * come back as a proposal to review here.
 */
export function SendDialog({ noteRef, content, targets, flush, onSent, onClose }: SendDialogProps) {
  const formId = useId();
  const ids = useId();
  const [targetId, setTargetId] = useState(targets[0]?.integrationId ?? "");
  const [instruction, setInstruction] = useState("");
  const [sections, setSections] = useState<string[]>([]);
  const [fresh, setFresh] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const target = targets.find((t) => t.integrationId === targetId) ?? targets[0];
  const headings = useMemo(
    () => bodySections(content).flatMap((s) => (s.heading ? [headingText(s.heading)] : [])),
    [content],
  );

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!instruction.trim()) return setError(`Say what ${target.name} should do.`);
    setPending(true);
    setError(null);
    try {
      await flush();
      const { job } = await api.launch({
        integrationId: target.integrationId,
        ...noteRef,
        instruction,
        sections,
        fresh: fresh || !target.hasConversation,
      });
      onSent(job);
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Couldn't send the note.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Send to ${targets.length === 1 ? target.name : "a harness"}`}
      description="It works on the note and sends its changes back as a proposal you review here. Nothing changes until you accept."
      footer={
        <>
          <Button onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form={formId} pending={pending}>
            Send
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void send(e)} className="flex flex-col gap-3.5">
        {targets.length > 1 && (
          <SelectField
            label="Harness"
            value={target.integrationId}
            options={targets.map((t) => ({ value: t.integrationId, label: t.name }))}
            onChange={(e) => setTargetId(e.target.value)}
          />
        )}
        <TextAreaField
          label="What should it do?"
          rows={4}
          value={instruction}
          placeholder="Tighten the opening and add a short conclusion."
          onChange={(e) => setInstruction(e.target.value)}
        />
        {headings.length > 0 && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-[13px] font-medium text-muted">Only these sections (optional)</legend>
            <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1.5">
              {headings.map((h, i) => (
                <label
                  key={`${h}-${i}`}
                  htmlFor={`${ids}-${i}`}
                  className="flex items-center gap-2 text-[14px] text-ink"
                >
                  <input
                    id={`${ids}-${i}`}
                    type="checkbox"
                    className="size-4 accent-accent"
                    checked={sections.includes(h)}
                    onChange={(e) =>
                      setSections((cur) => (e.target.checked ? [...cur, h] : cur.filter((s) => s !== h)))
                    }
                  />
                  {h}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {target.hasConversation && (
          <div className="flex items-start gap-2">
            <input
              id={`${ids}-fresh`}
              type="checkbox"
              className="mt-0.5 size-4 accent-accent"
              checked={fresh}
              aria-describedby={`${ids}-fresh-hint`}
              onChange={(e) => setFresh(e.target.checked)}
            />
            <div>
              <label htmlFor={`${ids}-fresh`} className="text-[14px] text-ink">
                Start a new conversation
              </label>
              <p id={`${ids}-fresh-hint`} className="text-[12.5px] text-muted">
                Otherwise {target.name} continues where it left off with this note, and knows what you
                accepted.
              </p>
            </div>
          </div>
        )}
        {error && (
          <p role="alert" className="text-[14px] text-danger">
            {error}
          </p>
        )}
      </form>
    </Dialog>
  );
}
