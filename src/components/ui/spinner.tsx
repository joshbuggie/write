import { LoaderCircle } from "lucide-react";
import { cn } from "@/lib/cn";

/** Small inline busy indicator for pending buttons and loading rows. Decorative: pair it with text or aria-busy. */
export function Spinner({ className }: { className?: string }) {
  return (
    <LoaderCircle aria-hidden strokeWidth={2} className={cn("size-4 shrink-0 animate-spin", className)} />
  );
}
