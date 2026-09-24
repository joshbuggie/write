"use client";

import { useEffect, useId, useRef, useState } from "react";
import type React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

type DialogProps = {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  /** "lg" for forms with several sections (Settings); confirmations and one-field forms stay "md". */
  size?: "md" | "lg";
};

/**
 * Modal built on native <dialog> + showModal(), so focus trapping, Esc and the top layer come from the
 * browser. Closes on Esc and on a backdrop click. Below `md` it renders as a bottom sheet.
 * Content only renders while open, so forms inside start fresh every time.
 */
export function Dialog({ open, onClose, title, description, children, footer, size = "md" }: DialogProps) {
  // A long form keeps its buttons in reach: they stick to the bottom edge while the fields scroll.
  const stickyFooter = size === "lg" && Boolean(footer);
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  // Latest props for the native event handlers, so a close we caused ourselves doesn't call onClose again.
  const latest = useRef({ open, onClose });
  useEffect(() => {
    latest.current = { open, onClose };
  });
  // A drag that starts inside the sheet and ends on the backdrop must not close it.
  const pressedBackdrop = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => {
        if (latest.current.open) latest.current.onClose();
      }}
      onPointerDown={(e) => {
        pressedBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && pressedBackdrop.current) e.currentTarget.close();
      }}
      className={
        "mx-0 mt-auto mb-0 w-full max-w-none overflow-y-auto overscroll-contain rounded-t-[14px] bg-surface text-ink " +
        "shadow-pop md:m-auto md:w-[calc(100%-2rem)] md:rounded-xl md:border md:border-line " +
        (size === "lg" ? "max-h-[92dvh] md:max-h-[min(88dvh,52rem)] md:max-w-xl" : "md:max-w-md") +
        // Fields scrolled into view (Tab) stop above the sticky footer instead of behind it.
        (stickyFooter ? " scroll-pb-24" : "")
      }
    >
      {open && (
        // wrap-anywhere is inherited: a long unbroken note or folder name wraps instead of scrolling sideways.
        <div
          className={cn(
            "px-5 pt-5 wrap-anywhere",
            !stickyFooter && "pb-[max(1.25rem,env(safe-area-inset-bottom))] md:pb-5",
          )}
        >
          <h2 id={titleId} className="text-[17px] font-semibold tracking-tight md:text-[16px]">
            {title}
          </h2>
          {description && (
            <div id={descriptionId} className="mt-1.5 text-[15px] leading-relaxed text-muted md:text-[14px]">
              {description}
            </div>
          )}
          {children && <div className="mt-4">{children}</div>}
          {footer &&
            (stickyFooter ? (
              // The sticky footer carries the safe-area inset itself. Phones: two equal buttons side by side.
              <div className="sticky bottom-0 -mx-5 mt-5 grid grid-cols-2 gap-2 border-t border-line bg-surface px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:flex md:justify-end md:pb-4">
                {footer}
              </div>
            ) : (
              <DialogFooter>{footer}</DialogFooter>
            ))}
        </div>
      )}
    </dialog>
  );
}

/** Button row at the bottom of a dialog: stacked full-width on phones (primary on top), right-aligned from md. */
export function DialogFooter({ children }: { children: React.ReactNode }) {
  return <div className="mt-5 flex flex-col-reverse gap-2 md:flex-row md:justify-end">{children}</div>;
}

type ConfirmDialogProps = {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  destructive?: boolean;
};

/**
 * Yes/no confirmation. Shows a pending spinner while `onConfirm` runs and closes when it resolves.
 * If it throws, the dialog stays open and shows the error message, so the user can retry or cancel.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel,
  destructive = false,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : "Something went wrong.");
    } finally {
      setPending(false);
    }
  }

  function close() {
    setError(null);
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      description={description}
      footer={
        <>
          <Button onClick={close} disabled={pending}>
            Cancel
          </Button>
          <Button variant={destructive ? "danger" : "primary"} pending={pending} onClick={confirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {error && (
        <p role="alert" className="text-[14px] text-danger">
          {error}
        </p>
      )}
    </Dialog>
  );
}
