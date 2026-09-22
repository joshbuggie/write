/**
 * What happens to an open note on browser events (⌘S, tab hidden, closing, leaving it): framework-free,
 * so the rules can be tested without a browser.
 */
import type { Autosaver } from "@/lib/autosave";

const ignore = () => {};

export type LifecycleDeps = {
  autosaver: Pick<Autosaver, "flushKeepalive" | "hasUnsavedChanges" | "flush" | "dispose">;
  /** Deleted, renamed, moved or closed: there is nothing left to save under this name. */
  isAbandoned(): boolean;
  /** A rename or move is on its way; discarding the note now would race it. */
  isRelocating(): boolean;
  /** An empty "Untitled" note, which should not outlive the visit. */
  isThrowaway(): boolean;
  /** Deletes the note on the server if it is still empty (and drops its draft). */
  discard(): void;
};

/**
 * Event handlers for an open note. Only in-app navigation discards an empty "Untitled" note. `pagehide`
 * also fires for a reload and for a page going into the back/forward cache, and the user comes straight
 * back to those: deleting the file there would greet them with "deleted outside write".
 */
export function createLifecycleHandlers(deps: LifecycleDeps) {
  const { autosaver } = deps;
  const saveNow = () => {
    if (!deps.isAbandoned()) autosaver.flush().catch(ignore);
  };
  return {
    /** ⌘S / Ctrl+S saves now instead of opening the browser's "Save page" dialog. */
    onKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.key.toLowerCase() !== "s") return;
      e.preventDefault();
      saveNow();
    },
    /** A hidden tab may never become visible again (phones kill background tabs). */
    onVisibilityChange() {
      if (document.visibilityState === "hidden") saveNow();
    },
    onBeforeUnload(e: BeforeUnloadEvent) {
      if (deps.isAbandoned() || !autosaver.hasUnsavedChanges()) return;
      e.preventDefault();
      e.returnValue = ""; // Safari still needs this to show the prompt
    },
    /** The page may be discarded after this; only keepalive requests are sure to go out. */
    onPageHide() {
      if (!deps.isAbandoned()) autosaver.flushKeepalive();
    },
    /**
     * In-app navigation: the page lives on, so besides the keepalive PUT (which survives closing the tab
     * right after) a normal flush can finish edits that were waiting on a save already in flight.
     */
    onLeave(): Promise<void> {
      if (deps.isAbandoned()) return Promise.resolve();
      const throwaway = !deps.isRelocating() && deps.isThrowaway();
      if (!throwaway) autosaver.flushKeepalive();
      const settled = autosaver.hasUnsavedChanges() ? autosaver.flush().catch(ignore) : Promise.resolve();
      return settled.finally(() => {
        autosaver.dispose();
        if (throwaway) deps.discard();
      });
    },
  };
}

type ClickLike = Pick<MouseEvent, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "target">;

/** A plain primary click on a link to another page of this app or elsewhere: the user is leaving. */
export function isLeavingClick(e: ClickLike, here: { origin: string; pathname: string }): boolean {
  if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return false;
  const anchor = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
  if (!anchor || anchor.hasAttribute("download") || (anchor.target && anchor.target !== "_self"))
    return false;
  const url = new URL(anchor.href, here.origin);
  return url.origin !== here.origin || url.pathname !== here.pathname;
}

/**
 * Watches for the user heading elsewhere while an async file operation runs. Clicking a link blurs the
 * title, which starts a rename, and the navigation the click started may not have committed when the
 * rename lands; following the rename then would drag the user back. Back/forward counts as leaving too.
 */
export function watchForLeaving(): { hasLeft(): boolean; stop(): void } {
  const start = window.location.pathname;
  let left = false;
  const onClick = (e: MouseEvent) => {
    if (isLeavingClick(e, window.location)) left = true;
  };
  const onPopState = () => {
    left = true;
  };
  // Capture phase: runs before next/link's handler prevents the default and starts the navigation.
  document.addEventListener("click", onClick, true);
  window.addEventListener("popstate", onPopState);
  return {
    hasLeft: () => left || window.location.pathname !== start,
    stop() {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPopState);
    },
  };
}
