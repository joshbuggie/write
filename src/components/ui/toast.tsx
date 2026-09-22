"use client";

import { TriangleAlert } from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/lib/cn";

type ToastInput = {
  message: string;
  tone?: "neutral" | "error";
  durationMs?: number;
  action?: { label: string; onClick: () => void };
};
type ToastApi = { show(t: ToastInput): void };
type ActiveToast = ToastInput & { id: number };

const MAX_VISIBLE = 3;
const ToastContext = createContext<ToastApi | null>(null);

/**
 * Hosts transient notifications ("Updated from disk", import results, failed actions). Mounted once by the
 * notes layout. Phones: centered above the keyboard/toolbar; from md: bottom-right.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ActiveToast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
    setToasts((all) => all.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      const id = nextId.current++;
      setToasts((all) => [...all, { ...input, id }].slice(-MAX_VISIBLE));
      const duration = input.durationMs ?? (input.tone === "error" ? 6000 : 4000);
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), duration),
      );
    },
    [dismiss],
  );

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach((timer) => clearTimeout(timer));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        className={cn(
          "pointer-events-none fixed inset-x-4 z-50 flex flex-col items-center gap-2",
          "bottom-[calc(var(--kb)+56px+env(safe-area-inset-bottom))]",
          "md:inset-x-auto md:right-4 md:bottom-4 md:items-end",
        )}
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={cn(
              "pointer-events-auto flex max-w-full items-center gap-3 rounded-lg border border-line bg-surface",
              "py-2.5 pr-2 pl-3.5 text-[15px] shadow-pop md:max-w-sm md:text-[14px]",
              t.tone === "error" ? "text-danger" : "text-ink",
            )}
          >
            {t.tone === "error" && (
              <TriangleAlert aria-hidden strokeWidth={1.75} className="size-4 shrink-0" />
            )}
            <span className="min-w-0 flex-1 py-0.5 pr-1.5">{t.message}</span>
            {t.action && (
              <button
                type="button"
                className="h-7 shrink-0 rounded-md px-2 font-medium text-accent hover:bg-accent-soft pointer-coarse:h-11"
                onClick={() => {
                  dismiss(t.id);
                  t.action?.onClick();
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** Show a toast from any client component under ToastProvider. */
export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("ToastProvider is missing");
  return ctx;
}
