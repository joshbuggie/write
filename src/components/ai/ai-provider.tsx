"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { SettingsDialog } from "@/components/settings/settings-dialog";
import { useActiveNote } from "@/components/shell/shell-context";
import { useToast } from "@/components/ui/toast";
import {
  getMockSettings,
  getServerMockSettings,
  saveMockSettings,
  subscribeMockSettings,
} from "@/lib/ai/mock/settings-store";
import type { AiSettings } from "@/lib/ai/settings";
import { matchesShortcut } from "@/lib/ai/shortcut";

/** What the open editor offers the header button and the shortcut: a way to open its prompt window. */
export type PromptTarget = { open: () => void };

type AiValue = {
  settings: AiSettings;
  openSettings: () => void;
  /** True while an editor that supports the prompt window is mounted. */
  canPrompt: boolean;
  openPrompt: () => void;
  /** Called by the visual editor; returns the unregister function. */
  registerPromptTarget: (target: PromptTarget) => () => void;
};

const AiContext = createContext<AiValue | null>(null);

/**
 * Owns the AI settings and the Settings dialog, and connects the header button and the global shortcut
 * to whichever editor is open. When the assistant is off, none of that is wired up: no shortcut listener,
 * no button, no editor plugin.
 */
export function AiProvider({ children }: { children: ReactNode }) {
  // MOCKUP: settings come from localStorage; the real version loads them from the server in the layout.
  const settings = useSyncExternalStore(subscribeMockSettings, getMockSettings, getServerMockSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const toast = useToast();
  const noteOpen = useActiveNote() !== null;
  const [target, setTarget] = useState<PromptTarget | null>(null);
  const targetRef = useRef<PromptTarget | null>(null);

  const registerPromptTarget = useCallback((next: PromptTarget) => {
    targetRef.current = next;
    setTarget(next);
    return () => {
      if (targetRef.current !== next) return;
      targetRef.current = null;
      setTarget(null);
    };
  }, []);

  const openPrompt = useCallback(() => targetRef.current?.open(), []);
  // Settings unmounts its <dialog> on close, so the browser can't return focus itself.
  const returnFocus = useRef<HTMLElement | null>(null);
  const openSettings = useCallback(() => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSettingsOpen(true);
  }, []);
  useEffect(() => {
    if (settingsOpen || !returnFocus.current) return;
    if (returnFocus.current.isConnected) returnFocus.current.focus({ preventScroll: true });
    returnFocus.current = null;
  }, [settingsOpen]);

  const { enabled, shortcut } = settings;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesShortcut(e, shortcut)) return;
      if (document.querySelector("dialog:modal")) return; // a dialog is in front of the note
      if (!targetRef.current) {
        // MOCKUP: a note open in the Markdown source editor. Say why nothing opened, rather than nothing.
        if (!noteOpen) return;
        e.preventDefault();
        toast.show({ message: "AI works in the visual editor for now." });
        return;
      }
      e.preventDefault();
      targetRef.current.open();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, shortcut, noteOpen, toast]);

  const value = useMemo<AiValue>(
    () => ({
      settings,
      openSettings,
      canPrompt: settings.enabled && target !== null,
      openPrompt,
      registerPromptTarget,
    }),
    [settings, openSettings, target, openPrompt, registerPromptTarget],
  );

  return (
    <AiContext.Provider value={value}>
      {children}
      {settingsOpen && (
        <SettingsDialog initial={settings} onSave={saveMockSettings} onClose={() => setSettingsOpen(false)} />
      )}
    </AiContext.Provider>
  );
}

/** AI settings and actions for any client component under the notes layout. */
export function useAi(): AiValue {
  const value = useContext(AiContext);
  if (!value) throw new Error("AiProvider is missing");
  return value;
}
