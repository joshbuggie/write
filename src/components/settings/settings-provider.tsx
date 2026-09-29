"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { SettingsResponse } from "@/lib/api-contract";
import { api } from "@/lib/api-client";
import { SettingsDialog } from "./settings-dialog";

type SettingsValue = {
  /** The saved settings as the browser may see them (API keys reduced to hints). */
  settings: SettingsResponse;
  openSettings: () => void;
};

const SettingsContext = createContext<SettingsValue | null>(null);

/**
 * Owns the saved settings and the Settings dialog, so the AI assistant and the note screen read the same
 * copy and see a save at once. The notes layout loads them on the server (so nothing flashes from defaults
 * to the saved values), and every refresh of the layout brings them up to date again.
 */
export function SettingsProvider({
  initialSettings,
  username,
  children,
}: {
  initialSettings: SettingsResponse;
  /** The signed-in account, for the Account section of Settings; null while sign-in is off. */
  username: string | null;
  children: ReactNode;
}) {
  const [settings, setSettings] = useState(initialSettings);
  const [loaded, setLoaded] = useState(initialSettings);
  if (initialSettings !== loaded) {
    // A fresh server render (router.refresh, focus): its settings win over what this tab last saw.
    setLoaded(initialSettings);
    setSettings(initialSettings);
  }
  const [open, setOpen] = useState(false);

  // Settings unmounts its <dialog> on close, so the browser can't return focus itself.
  const returnFocus = useRef<HTMLElement | null>(null);
  const openSettings = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);
  useEffect(() => {
    if (open || !returnFocus.current) return;
    if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [open]);

  const value = useMemo(() => ({ settings, openSettings }), [settings, openSettings]);

  return (
    <SettingsContext.Provider value={value}>
      {children}
      {open && (
        <SettingsDialog
          initial={settings}
          username={username}
          onSave={async (next) => setSettings(await api.saveSettings(next))}
          onClose={() => setOpen(false)}
        />
      )}
    </SettingsContext.Provider>
  );
}

/** The saved settings and a way to open the dialog, for any client component under the notes layout. */
export function useSettings(): SettingsValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("SettingsProvider is missing");
  return value;
}
