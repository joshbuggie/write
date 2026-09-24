import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

/** The prompt window while the assistant is on but has no usable connection: says what's missing instead of failing on send. */
export function NotConnected({ onOpenSettings }: { onOpenSettings: () => void }) {
  return (
    <div className="flex flex-col gap-3 px-3 py-3 md:flex-row md:items-center">
      <Sparkles aria-hidden strokeWidth={1.75} className="size-[18px] shrink-0 text-accent max-md:hidden" />
      <div className="min-w-0 flex-1">
        <p className="text-[14px] font-medium">Connect a model to use AI</p>
        <p className="text-[13px] text-muted">
          Add a connection in Settings: a hosted API or a server on your network.
        </p>
      </div>
      {/* Focus lands here, so Esc (handled on the window) works without a text field to type in. */}
      <Button size="sm" variant="primary" autoFocus onClick={onOpenSettings}>
        Open Settings
      </Button>
    </div>
  );
}
