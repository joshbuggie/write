/** The lock lives on globalThis so dev-mode HMR and duplicate module graphs still share one queue. */
const holder = globalThis as typeof globalThis & { __writeLock?: Promise<void> };

/**
 * Runs `fn` after every previously queued mutation has settled. All storage writes go through this, so
 * check-then-act sequences (collision checks, version checks) can't interleave. Reads never take it.
 * Assumes a single server process per data dir.
 */
export function withWriteLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = holder.__writeLock ?? Promise.resolve();
  const run = previous.then(() => fn());
  holder.__writeLock = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}
