"use client";

import { Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { IntegrationView } from "@/lib/integrations";
import { agentApiBase, mcpUrl, setupSteps } from "./integration-summary";

type TokenRevealProps = { integration: IntegrationView; token: string; onDone: () => void };

/**
 * The one time a token is shown (docs/design-decisions.md#d31), with how to connect this kind of harness
 * to write's MCP endpoint.
 * The token sits in a read-only field that selects itself, because the clipboard API only works over
 * HTTPS or on localhost, and write is often reached over plain HTTP on the LAN.
 */
export function TokenReveal({ integration, token, onDone }: TokenRevealProps) {
  const toast = useToast();
  // Shown only after a click in the dialog, never rendered on the server, so window is always there.
  const origin = window.location.origin;
  const setup = setupSteps(integration.kind, mcpUrl(origin));

  async function copy() {
    try {
      await navigator.clipboard.writeText(token);
      toast.show({ message: "Token copied" });
    } catch {
      toast.show({ message: "Couldn't copy: select the token and copy it yourself.", tone: "error" });
    }
  }

  return (
    <div role="status" className="flex flex-col gap-3 rounded-lg border border-line bg-canvas px-3 py-3">
      <p className="text-[14px] font-semibold text-ink">Token for {integration.name}</p>
      <div className="flex gap-2">
        <input
          readOnly
          aria-label={`Token for ${integration.name}`}
          value={token}
          onFocus={(e) => e.currentTarget.select()}
          className="h-9 w-full min-w-0 rounded-md border border-line-strong bg-surface px-2.5 font-mono text-[13px] text-ink pointer-coarse:h-11"
        />
        <Button onClick={() => void copy()}>
          <Copy aria-hidden strokeWidth={1.75} className="size-4" />
          Copy
        </Button>
      </div>
      <p className="text-[13px] leading-relaxed text-warning">
        Copy it now. write keeps only a fingerprint of it, so it can&apos;t show it again. If it&apos;s lost,
        make a new one.
      </p>
      <div className="flex flex-col gap-1.5 text-[13px] leading-relaxed text-muted">
        <p>{setup.intro}</p>
        <pre className="overflow-x-auto rounded-md border border-line bg-surface px-2.5 py-2 font-mono text-[12.5px] text-ink">
          {setup.snippet}
        </pre>
        <p>
          Harnesses without MCP can use the same token over plain HTTP at{" "}
          <code className="font-mono break-all text-ink">{agentApiBase(origin)}</code>:{" "}
          <code className="font-mono text-ink">GET /tree</code>,{" "}
          <code className="font-mono text-ink">GET /notes</code>
          {integration.canCreate ? (
            <>
              , <code className="font-mono text-ink">POST /notes</code> (new notes)
            </>
          ) : null}{" "}
          and <code className="font-mono text-ink">POST /proposals</code>.
        </p>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant="primary" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}
