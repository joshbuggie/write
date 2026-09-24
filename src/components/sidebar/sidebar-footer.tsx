"use client";

import { Download, FolderPlus, LogOut, Plug, Settings, SquarePen, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useAi } from "@/components/ai/ai-provider";
import { IntegrationsDialog } from "@/components/integrations/integrations-dialog";
import { useFlushActiveNote } from "@/components/shell/shell-context";
import { Button, buttonStyles } from "@/components/ui/button";
import { DownloadLink } from "@/components/ui/download-link";
import { api } from "@/lib/api-client";
import { cn } from "@/lib/cn";
import { downloadAllHref, loginHref } from "@/lib/routes";
import { NewFolderForm } from "./new-folder-form";

type Variant = "panel" | "page";

const ROW = {
  panel: "h-8 text-[13px] pointer-coarse:h-11",
  page: "h-11 text-[16px]",
} as const;

type SidebarActionsProps = {
  variant: Variant;
  authEnabled: boolean;
  /** Every folder in the library, for the Integrations dialog's folder choices. */
  folders: string[];
};

/**
 * Library-level actions at the end of the list: New folder, Integrations, Settings, and Sign out while
 * sign-in is on. The desktop panel also puts "Download all" here; phones have it in the bottom bar instead.
 */
export function SidebarActions({ variant, authEnabled, folders }: SidebarActionsProps) {
  const [addingFolder, setAddingFolder] = useState(false);
  const [integrationsOpen, setIntegrationsOpen] = useState(false);
  const { signOut, signingOut } = useSignOut();
  const { openSettings } = useAi();
  const row = cn(
    "flex w-full items-center gap-2.5 rounded-md px-2.5 text-muted hover:bg-hover hover:text-ink",
    ROW[variant],
  );
  return (
    <div className={cn("flex flex-col gap-px", variant === "panel" && "shrink-0 border-t border-line p-2")}>
      {addingFolder ? (
        <NewFolderForm onDone={() => setAddingFolder(false)} />
      ) : (
        <button type="button" className={row} onClick={() => setAddingFolder(true)}>
          <RowIcon icon={FolderPlus} />
          New folder
        </button>
      )}
      {variant === "panel" && (
        <DownloadLink href={downloadAllHref()} className={row}>
          <RowIcon icon={Download} />
          Download all (.zip)
        </DownloadLink>
      )}
      <button type="button" className={row} onClick={() => setIntegrationsOpen(true)}>
        <RowIcon icon={Plug} />
        Integrations
      </button>
      {integrationsOpen && (
        <IntegrationsDialog
          library={folders}
          authEnabled={authEnabled}
          onClose={() => setIntegrationsOpen(false)}
        />
      )}
      <button type="button" className={row} onClick={openSettings}>
        <RowIcon icon={Settings} />
        Settings
      </button>
      {authEnabled && (
        <button type="button" className={row} onClick={signOut} disabled={signingOut}>
          <RowIcon icon={LogOut} />
          Sign out
        </button>
      )}
    </div>
  );
}

/** Phone library's fixed bottom bar: Download all + New note, padded above the home indicator. */
export function LibraryBottomBar({ onNewNote, pending }: { onNewNote: () => void; pending: boolean }) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-canvas/90 pb-[env(safe-area-inset-bottom)] backdrop-blur">
      <div className="flex gap-2 px-[max(1rem,env(safe-area-inset-left))] py-2.5">
        <DownloadLink href={downloadAllHref()} className={buttonStyles("secondary")}>
          <Download aria-hidden strokeWidth={1.75} className="size-5" />
          Download all
        </DownloadLink>
        <Button variant="primary" className="flex-1" pending={pending} onClick={onNewNote}>
          {!pending && <SquarePen aria-hidden strokeWidth={1.75} className="size-5" />}
          New note
        </Button>
      </div>
    </div>
  );
}

function RowIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon aria-hidden strokeWidth={1.75} className="size-4 shrink-0 pointer-coarse:size-5" />;
}

/** Save the open note, end the session, then do a full load of /login so no private data stays in memory. */
function useSignOut() {
  const flushActiveNote = useFlushActiveNote();
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    await flushActiveNote();
    try {
      await api.logout();
    } catch {
      // Already signed out or offline: the login page is still the right place to go.
    }
    window.location.assign(loginHref());
  }
  return { signOut, signingOut };
}
