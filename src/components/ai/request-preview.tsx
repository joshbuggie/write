"use client";

import type { AiMessages } from "@/lib/ai/prompt";
import { connectionName, presetFor, type AiConnection } from "@/lib/ai/settings";

type RequestPreviewProps = {
  /** Where this request would go: the connection picked in the prompt window. */
  connection: AiConnection;
  messages: AiMessages;
  /** Opens Settings, where the instructions are edited. */
  onEditInstructions: () => void;
};

const LABEL = "flex items-center justify-between text-[12px] font-medium text-muted";
const BLOCK =
  "mt-1 max-h-36 overflow-y-auto rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[12px] " +
  "leading-relaxed whitespace-pre-wrap text-ink wrap-anywhere";

/** Host and port only: enough to recognize the server without the path noise. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * "What gets sent": the exact instructions, note text and request, and where they go, before anything
 * is sent. The instructions are the one hidden prompt in the feature, so they are shown here in full and
 * are one click from being edited.
 */
export function RequestPreview({ connection, messages, onEditInstructions }: RequestPreviewProps) {
  return (
    <div className="border-t border-line bg-canvas px-3 py-2.5">
      <dl className="flex flex-col gap-2.5">
        <div>
          <dt className={LABEL}>Sent to</dt>
          <dd className="mt-0.5 text-[13px] text-ink">
            {connectionName(connection)} · {presetFor(connection.provider).label} · {connection.model} ·{" "}
            <span className="font-mono text-[12px]">{hostOf(connection.baseUrl)}</span>
          </dd>
        </div>
        <div>
          <dt className={LABEL}>
            Instructions (system prompt)
            <button
              type="button"
              onClick={onEditInstructions}
              className="rounded px-1 text-accent hover:bg-accent-soft pointer-coarse:h-11 pointer-coarse:px-2"
            >
              Edit
            </button>
          </dt>
          <dd className={BLOCK}>{messages.system || "(none)"}</dd>
        </div>
        <div>
          <dt className={LABEL}>Note text and request</dt>
          <dd className={BLOCK}>{messages.user}</dd>
        </div>
      </dl>
      <p className="mt-2 text-[12px] text-subtle">Nothing is sent until you press Enter or pick an action.</p>
    </div>
  );
}
