"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { SIDEBAR_COOKIE } from "@/lib/constants";
import type { NoteRef } from "@/lib/types";

export type ActiveNote = { ref: NoteRef; flush: () => Promise<void> };

type ShellValue = {
  active: ActiveNote | null;
  setActive: Dispatch<SetStateAction<ActiveNote | null>>;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
};

const ShellContext = createContext<ShellValue | null>(null);

export function ShellProvider({
  initialSidebarCollapsed,
  children,
}: {
  initialSidebarCollapsed: boolean;
  children: ReactNode;
}) {
  const [active, setActive] = useState<ActiveNote | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(initialSidebarCollapsed);
  const toggleSidebar = useCallback(() => setSidebarCollapsed((c) => !c), []);
  useEffect(() => {
    document.cookie = `${SIDEBAR_COOKIE}=${sidebarCollapsed ? "collapsed" : "open"}; Path=/; Max-Age=31536000; SameSite=Lax`;
  }, [sidebarCollapsed]);
  const value = useMemo(
    () => ({ active, setActive, sidebarCollapsed, toggleSidebar }),
    [active, sidebarCollapsed, toggleSidebar],
  );
  return <ShellContext.Provider value={value}>{children}</ShellContext.Provider>;
}

function useShell(): ShellValue {
  const v = useContext(ShellContext);
  if (!v) throw new Error("ShellProvider is missing");
  return v;
}

/** The note currently open in the editor, if any. */
export function useActiveNote(): ActiveNote | null {
  return useShell().active;
}

/** Called once by the note screen: registers the open note for the lifetime of the component. */
export function useRegisterActiveNote(ref: NoteRef, flush: () => Promise<void>): void {
  const { setActive } = useShell();
  const flushRef = useRef(flush);
  useEffect(() => {
    flushRef.current = flush;
  });
  const { folder, name } = ref;
  useEffect(() => {
    const entry: ActiveNote = { ref: { folder, name }, flush: () => flushRef.current() };
    setActive(entry);
    return () => setActive((cur) => (cur === entry ? null : cur));
  }, [folder, name, setActive]);
}

/** Flush the open note's pending edits before downloads / structural changes. Never throws. */
export function useFlushActiveNote(): () => Promise<void> {
  const { active } = useShell();
  return useCallback(async () => {
    try {
      await active?.flush();
    } catch {
      /* the note's own UI reports save errors */
    }
  }, [active]);
}

export function useSidebar(): { collapsed: boolean; toggle: () => void } {
  const { sidebarCollapsed, toggleSidebar } = useShell();
  return { collapsed: sidebarCollapsed, toggle: toggleSidebar };
}
