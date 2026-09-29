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
import { useSettings } from "@/components/settings/settings-provider";
import { useActiveNote } from "@/components/shell/shell-context";
import { useToast } from "@/components/ui/toast";
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
 * Connects the header button and the global shortcut to whichever editor is open. When the assistant is
 * off, none of that is wired up: no shortcut listener, no button, no editor plugin. The settings come from
 * SettingsProvider, which the notes layout fills on the server, so a switched-off assistant never flashes
 * into view.
 */
export function AiProvider({ children }: { children: ReactNode }) {
  const {
    settings: { ai: settings },
    openSettings,
  } = useSettings();
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

  const { enabled, shortcut } = settings;
  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || !matchesShortcut(e, shortcut)) return;
      if (document.querySelector("dialog:modal")) return; // a dialog is in front of the note
      if (!targetRef.current) {
        // A note is open but has no editor (read-only, or still loading): say why nothing opened.
        if (!noteOpen) return;
        e.preventDefault();
        toast.show({ message: "There's no editor open for AI to work in." });
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

  return <AiContext.Provider value={value}>{children}</AiContext.Provider>;
}

/** AI settings and actions for any client component under the notes layout. */
export function useAi(): AiValue {
  const value = useContext(AiContext);
  if (!value) throw new Error("AiProvider is missing");
  return value;
}
