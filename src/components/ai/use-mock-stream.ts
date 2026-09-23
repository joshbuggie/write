"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Where a reply is: waiting for the first token, arriving, or finished (complete or stopped). */
export type StreamState = { phase: "thinking" | "streaming" | "done"; text: string; stopped: boolean };

const THINK_MS = 600;
const TICK_MS = 28;

/**
 * MOCKUP ONLY: plays a canned reply a couple of words at a time, so the prompt window's streaming,
 * Stop and done states can be tried. The real version reads the server's streamed response instead.
 */
export function useMockStream() {
  const [state, setState] = useState<StreamState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const clear = () => clearTimeout(timer.current);

  const start = useCallback((reply: string) => {
    clear();
    const words = reply.split(/(\s+)/);
    let shown = 0;
    setState({ phase: "thinking", text: "", stopped: false });
    const tick = () => {
      shown = Math.min(words.length, shown + 4);
      const done = shown >= words.length;
      setState({ phase: done ? "done" : "streaming", text: words.slice(0, shown).join(""), stopped: false });
      if (!done) timer.current = setTimeout(tick, TICK_MS);
    };
    timer.current = setTimeout(tick, THINK_MS);
  }, []);

  const stop = useCallback(() => {
    clear();
    setState((s) => (s && s.phase !== "done" ? { ...s, phase: "done", stopped: true } : s));
  }, []);

  useEffect(() => clear, []);

  return { state, start, stop };
}
