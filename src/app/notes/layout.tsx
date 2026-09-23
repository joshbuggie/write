import { cookies } from "next/headers";
import type React from "react";
import { AiProvider } from "@/components/ai/ai-provider";
import { AppShell } from "@/components/shell/app-shell";
import { ShellProvider } from "@/components/shell/shell-context";
import { StorageUnavailable } from "@/components/shell/storage-unavailable";
import { ToastProvider } from "@/components/ui/toast";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import { isAuthEnabled, loadAiSettings, loadTree } from "@/lib/server/loaders";
import { StorageError } from "@/lib/server/storage";
import type { Tree } from "@/lib/types";

/**
 * Shell for every notes screen: loads the folder tree once per request and reads the sidebar cookie on the
 * server, so a collapsed sidebar renders collapsed with no flash. If the data folder is unusable, explains
 * how to fix it instead of showing a generic error.
 */
export default async function NotesLayout({ children }: { children: React.ReactNode }) {
  let tree: Tree;
  try {
    tree = await loadTree();
  } catch (err) {
    if (err instanceof StorageError && err.code === "storage_unavailable") {
      return <StorageUnavailable message={err.message} />;
    }
    throw err;
  }
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "collapsed";
  const aiSettings = await loadAiSettings();

  return (
    <ShellProvider initialSidebarCollapsed={sidebarCollapsed}>
      <ToastProvider>
        <AiProvider initialSettings={aiSettings}>
          <AppShell tree={tree} authEnabled={isAuthEnabled()}>
            {children}
          </AppShell>
        </AiProvider>
      </ToastProvider>
    </ShellProvider>
  );
}
