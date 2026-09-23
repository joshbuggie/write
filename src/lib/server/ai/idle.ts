/**
 * The inactivity timeout of a model request (see docs/design-decisions.md#d29). It fires only after a
 * stretch with no sign of life (no answer yet, or no new bytes of the body), so a slow model that keeps
 * streaming is never cut off, however long its reply takes, while a server that has gone silent still is.
 * A runaway reply is stopped by the reply cap instead (MAX_REPLY_CHARS in ./reply.ts).
 */

/** Restarts or ends the countdown. */
export type IdleTimer = {
  /** Something arrived: the countdown starts over. */
  touch: () => void;
  /** The request is over: the timer never fires. */
  stop: () => void;
};

/**
 * Aborts `controller` after `ms` without a touch(), with a TimeoutError reason, which fetch passes on to
 * the pending request or body and the error mapping reads as "didn't answer in time" (isTimeout).
 */
export function idleTimer(ms: number, controller: AbortController): IdleTimer {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  const fire = () => {
    controller.abort(new DOMException(`Nothing arrived for ${ms} ms.`, "TimeoutError"));
  };
  const touch = () => {
    if (stopped) return;
    clearTimeout(timer);
    timer = setTimeout(fire, ms);
  };
  touch();
  return {
    touch,
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}

/**
 * `body`, restarting `timer` on every chunk and stopping it once the body ends, fails or is cancelled.
 * Cancelling the result cancels `body`, so the connection is let go as before.
 */
export function watchBody(body: ReadableStream<Uint8Array>, timer: IdleTimer): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        timer.stop();
        throw err;
      }
      if (chunk.done) {
        timer.stop();
        controller.close();
        return;
      }
      timer.touch();
      controller.enqueue(chunk.value);
    },
    cancel(reason) {
      timer.stop();
      return reader.cancel(reason);
    },
  });
}
