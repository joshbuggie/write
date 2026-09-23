"use client";

import { ChevronDown } from "lucide-react";
import { connectionName, type AiConnection } from "@/lib/ai/settings";

type ConnectionPickerProps = {
  connections: AiConnection[];
  value: string;
  onChange: (id: string) => void;
};

/**
 * Where this request goes, when more than one connection is saved (say, a local model and a hosted one).
 * A native <select>, so phones get their own picker. It starts on the default connection every time; the
 * model is in the tooltip and under "What gets sent", which keeps the footer short.
 */
export function ConnectionPicker({ connections, value, onChange }: ConnectionPickerProps) {
  const current = connections.find((c) => c.id === value);
  return (
    <div className="relative min-w-0 shrink">
      <select
        aria-label="Send to"
        title={current ? `${connectionName(current)} · ${current.model}` : undefined}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={
          "h-7 max-w-40 min-w-0 cursor-pointer appearance-none truncate rounded-md bg-transparent pr-6 pl-2 " +
          "text-[12.5px] text-muted hover:bg-hover hover:text-ink pointer-coarse:h-11 pointer-coarse:text-[14px]"
        }
      >
        {connections.map((c) => (
          <option key={c.id} value={c.id}>
            {connectionName(c)}
          </option>
        ))}
      </select>
      <ChevronDown
        aria-hidden
        strokeWidth={1.75}
        className="pointer-events-none absolute top-1/2 right-1.5 size-3.5 -translate-y-1/2 text-muted"
      />
    </div>
  );
}
