"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CompleteRequest, StopReason } from "@/lib/api-contract";
import { api, isApiError } from "@/lib/api-client";

/**
 * Where a reply is: waiting for the first words, arriving, or finished. A finished reply may have been
 * stopped, cut off (`stop: "length"`), declined by the model (`"refusal"`), or have failed (`error`).
 */
export type StreamState = {
  phase: "thinking" | "streaming" | "done";
  text: string;
  stopped: boolean;
  stop?: StopReason;
  error?: { message: string; code: string };
};

/**
 * Streams one reply at a time from the server. Text is shown at most once per frame, however fast it
 * arrives, so the preview doesn't re-render for every token. Starting a new reply, stop() and unmounting
 * all abort the request, which aborts the model's too.
 */
export function useReplyStream() {
  const [state, setState] = useState<StreamState | null>(null);
  const controller = useRef<AbortController | null>(null);
  const frame = useRef(0);
  // Everything received so far, including what arrived after the last frame, so Stop keeps all of it.
  const received = useRef("");

  const cancel = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    cancelAnimationFrame(frame.current);
    frame.current = 0; // a stale id would keep the next reply from ever scheduling a frame
  }, []);

  const start = useCallback(
    async (request: CompleteRequest) => {
      cancel();
      const own = new AbortController();
      controller.current = own;
      let text = "";
      received.current = "";
      setState({ phase: "thinking", text: "", stopped: false });
      const show = () => {
        frame.current = 0;
        if (controller.current === own) setState({ phase: "streaming", text, stopped: false });
      };
      try {
        const stop = await api.streamCompletion(
          request,
          (piece) => {
            text += piece;
            received.current = text;
            frame.current ||= requestAnimationFrame(show);
          },
          { signal: own.signal },
        );
        if (controller.current === own) setState({ phase: "done", text, stopped: false, stop });
      } catch (err) {
        if (own.signal.aborted) return; // stop() or a newer request already set the state
        const error = isApiError(err)
          ? { message: err.message, code: err.code }
          : { message: "Something went wrong while the reply was streaming.", code: "internal" };
        setState({ phase: "done", text, stopped: false, error });
      } finally {
        if (controller.current === own) {
          cancelAnimationFrame(frame.current);
          frame.current = 0;
          controller.current = null;
        }
      }
    },
    [cancel],
  );

  const stop = useCallback(() => {
    cancel();
    const text = received.current;
    setState((s) => (s && s.phase !== "done" ? { ...s, phase: "done", stopped: true, text } : s));
  }, [cancel]);

  useEffect(() => cancel, [cancel]);

  return { state, start, stop };
}
