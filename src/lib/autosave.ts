/**
 * Framework-free save engine for one open note: debounced autosave, single-flight PUTs, retries with
 * backoff, offline handling, conflict detection and crash-safety drafts. The note screen wires it to the
 * editor (markDirty on every change) and renders getState() via useSyncExternalStore.
 */
import { ApiError, isApiError } from "@/lib/api-client";
import { KEEPALIVE_MAX_BYTES } from "@/lib/constants";
import { byteLength } from "@/lib/names";
import type { Note, SavedNote } from "@/lib/types";

export type SaveState =
  | { kind: "saved"; at: number | null } // at = null → nothing saved this session yet
  | { kind: "dirty" }
  | { kind: "saving" }
  | { kind: "offline" } // navigator.onLine false or network error while offline
  | { kind: "error"; message: string; retrying: boolean }
  | { kind: "conflict"; current: Note | null }; // null = file deleted/renamed/folder gone elsewhere

/** What one save sends, besides the note's folder and name (which the caller binds). */
export type SaveInput = { content: string; baseVersion: string | null; force: boolean };

export interface AutosaverDeps {
  /** Full file text to save (front matter + body). Called only when a save is about to run. */
  getContent(): string;
  /** Persist; resolve with the saved note; reject with ApiError. Implemented with api.saveNote. */
  save(input: SaveInput, opts: { keepalive: boolean }): Promise<SavedNote>;
  /**
   * UTF-8 size of the whole request body save() would send. The browser's keepalive quota counts the
   * JSON body (escaped newlines and quotes, folder, name), not just the note text. Default: the JSON of
   * `input` alone.
   */
  bodyBytes?(input: SaveInput): number;
  /** Crash-safety draft hooks (drafts.ts bound to the note ref). */
  drafts?: { write(content: string, baseVersion: string): void; clear(): void };
  isOnline?(): boolean; // default: navigator.onLine ?? true
  now?(): number; // default: Date.now
  setTimeout?(fn: () => void, ms: number): unknown; // injectable for tests
  clearTimeout?(id: unknown): void;
}

export interface AutosaverOptions {
  /** Content considered already on disk (normalized serialization at open, or raw text in source mode). */
  baseline: string;
  /** Server version at open. */
  version: string;
  debounceMs?: number; // 750
  maxWaitMs?: number; // 5000
  retryDelaysMs?: number[]; // [1000, 2000, 5000, 10000, 30000] — last value repeats
}

export interface Autosaver {
  getState(): SaveState;
  subscribe(listener: () => void): () => void; // for useSyncExternalStore
  getVersion(): string;
  /** True for the open version and every version this autosaver produced. */
  isKnownVersion(version: string): boolean;
  /** true unless state is "saved" (i.e. dirty, saving, offline, error, conflict). */
  hasUnsavedChanges(): boolean;
  markDirty(): void; // O(1); call from editor onUpdate / textarea onChange
  flush(): Promise<void>; // save now; resolves when clean (no-op if unchanged); rejects ApiError
  flushKeepalive(): void; // best effort for pagehide/unmount: keepalive PUT if its body ≤ KEEPALIVE_MAX_BYTES, always writes draft first
  /** The editor text that isn't on disk yet, or null. Still works after dispose(), for handing edits on. */
  unsavedContent(): string | null;
  retry(): void;
  keepMine(): Promise<void>; // conflict resolution: force save current content
  adopt(content: string, version: string): void; // new baseline (use-disk-version / updated-from-disk); state → saved
  dispose(): void; // cancel timers; no save (caller calls flushKeepalive first)
}

const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
export const SIGNED_OUT_MESSAGE =
  "Signed out. Sign in again to keep saving; your changes are kept on this device.";

/** What a failed save means for the user (the error-mapping table in docs/design-decisions.md#d3). */
function stateForError(err: ApiError, online: boolean): SaveState {
  switch (err.code) {
    case "version_conflict":
      return { kind: "conflict", current: err.body?.current ?? null };
    case "not_found":
      return { kind: "conflict", current: null };
    case "network":
      return online ? { kind: "error", message: err.message, retrying: true } : { kind: "offline" };
    case "internal":
    case "storage_unavailable":
      return { kind: "error", message: err.message, retrying: true };
    case "unauthorized":
      return { kind: "error", message: SIGNED_OUT_MESSAGE, retrying: false };
    default:
      return { kind: "error", message: err.message, retrying: false };
  }
}

const isFailure = (s: SaveState) => s.kind === "error" || s.kind === "offline" || s.kind === "conflict";

/** Creates the save engine for one open note. Call dispose() when the note closes. */
export function createAutosaver(deps: AutosaverDeps, opts: AutosaverOptions): Autosaver {
  const debounceMs = opts.debounceMs ?? 750;
  const maxWaitMs = opts.maxWaitMs ?? 5000;
  const retryDelays = opts.retryDelaysMs?.length ? opts.retryDelaysMs : DEFAULT_RETRY_DELAYS_MS;
  const now = () => deps.now?.() ?? Date.now();
  const isOnline = () =>
    deps.isOnline?.() ?? (typeof navigator === "undefined" || navigator.onLine !== false);
  const setTimer = (fn: () => void, ms: number) => (deps.setTimeout ?? setTimeout)(fn, ms);
  const clearTimer = (id: unknown) => {
    if (id === undefined) return;
    if (deps.clearTimeout) deps.clearTimeout(id);
    else clearTimeout(id as ReturnType<typeof setTimeout>);
  };

  let baseline = opts.baseline;
  let version = opts.version;
  const knownVersions = new Set([version]);
  let state: SaveState = { kind: "saved", at: null };
  let lastSavedAt: number | null = null;
  let lastError: ApiError | null = null;
  const listeners = new Set<() => void>();

  let editSeq = 0; // bumped by markDirty; tells whether content changed while a save was in flight
  let dirtySince: number | null = null; // first unsaved edit, for maxWait
  let timer: unknown; // the pending debounce OR retry (never both)
  let retryAttempt = 0;
  let inFlight: Promise<void> | null = null;
  let epoch = 0; // bumped by adopt/dispose so late results of older saves are ignored
  let disposed = false;
  // Text flushKeepalive could only put in a draft because a save was in flight. That draft names the
  // in-flight save's base version; once that save lands (often after the page is gone) it must name the
  // new version, or reopening the note would flag the user's own last keystrokes as a conflict.
  let keepaliveDraft: string | null = null;
  const bodyBytes = (input: SaveInput) => deps.bodyBytes?.(input) ?? byteLength(JSON.stringify(input));

  function setState(next: SaveState) {
    state = next;
    listeners.forEach((listener) => listener());
  }

  function arm(ms: number) {
    clearTimer(timer);
    timer = setTimer(() => {
      timer = undefined;
      void startSave(false);
    }, ms);
  }

  /** Debounce, but never let continuous typing postpone a save past maxWait. */
  const scheduleDebounced = () =>
    arm(Math.max(0, Math.min(debounceMs, (dirtySince ?? now()) + maxWaitMs - now())));

  const scheduleRetry = () => arm(retryDelays[Math.min(retryAttempt++, retryDelays.length - 1)]);

  const currentError = () => lastError ?? new ApiError(0, "internal", "Not saved.");

  function startSave(force: boolean, keepalive = false, content?: string): Promise<void> {
    if (disposed) return Promise.resolve();
    if (inFlight) return inFlight; // at most one PUT; edits made meanwhile get a follow-up save
    inFlight = runSave(force, keepalive, content ?? deps.getContent()).finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function runSave(force: boolean, keepalive: boolean, content: string): Promise<void> {
    clearTimer(timer);
    timer = undefined;
    if (!force && content === baseline) {
      dirtySince = null;
      retryAttempt = 0;
      // Undone back to the file: a draft an earlier failed save left behind would bring the edit back.
      if (state.kind !== "saved") {
        deps.drafts?.clear();
        setState({ kind: "saved", at: lastSavedAt });
      }
      return;
    }
    const sentEpoch = epoch;
    const sentSeq = editSeq;
    const baseVersion = version;
    deps.drafts?.write(content, baseVersion); // before every PUT: survives a killed tab
    keepaliveDraft = null;
    dirtySince = null;
    setState({ kind: "saving" });

    let saved: SavedNote | null = null;
    let failure: ApiError | null = null;
    try {
      saved = await deps.save({ content, baseVersion, force }, { keepalive });
    } catch (err) {
      failure = isApiError(err) ? err : new ApiError(0, "internal", "Couldn't save this note.");
    }
    // The draft is on disk now; keep it only if the user typed after this PUT was sent.
    if (saved && editSeq === sentSeq) deps.drafts?.clear();
    else if (saved && keepaliveDraft !== null) deps.drafts?.write(keepaliveDraft, saved.version);

    if (sentEpoch !== epoch) {
      // Superseded by adopt(): ignore the result, but don't strand edits made since.
      if (!disposed && state.kind === "dirty") scheduleDebounced();
      return;
    }
    if (failure) {
      lastError = failure;
      setState(stateForError(failure, isOnline()));
      if (state.kind === "offline" || (state.kind === "error" && state.retrying)) scheduleRetry();
      return;
    }
    if (!saved) return;
    version = saved.version;
    knownVersions.add(saved.version);
    baseline = content;
    lastSavedAt = now();
    lastError = null;
    retryAttempt = 0;
    if (editSeq === sentSeq) {
      setState({ kind: "saved", at: lastSavedAt });
    } else {
      setState({ kind: "dirty" });
      scheduleDebounced(); // exactly one follow-up, based on the new version
    }
  }

  const onOnline = () => {
    if (state.kind === "offline" || state.kind === "error") autosaver.retry();
  };
  if (typeof window !== "undefined") window.addEventListener("online", onOnline);

  const autosaver: Autosaver = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getVersion: () => version,
    isKnownVersion: (v) => knownVersions.has(v),
    hasUnsavedChanges: () => state.kind !== "saved",

    markDirty() {
      if (disposed) return;
      editSeq++;
      dirtySince ??= now();
      // Saving: the in-flight save schedules the follow-up. Offline / retrying error: the retry picks the
      // edit up. Conflict: the user must choose first.
      if (state.kind === "saved" || state.kind === "dirty" || (state.kind === "error" && !state.retrying)) {
        if (state.kind !== "dirty") setState({ kind: "dirty" });
        scheduleDebounced();
      }
    },

    async flush() {
      // Bounded: a save that was in flight may leave newer edits behind, which need one more save.
      for (let attempt = 0; attempt < 3; attempt++) {
        if (disposed) return;
        if (inFlight) {
          await inFlight;
          continue;
        }
        if (state.kind === "conflict") throw currentError();
        if (state.kind === "saved") return;
        await startSave(false);
        if (isFailure(state)) throw currentError();
      }
    },

    flushKeepalive() {
      if (disposed) return;
      const content = deps.getContent();
      if (inFlight) {
        // Even text equal to the baseline needs the draft: after an undo, the save in flight still puts
        // the undone text on disk. A second concurrent PUT could race into a false conflict.
        deps.drafts?.write(content, version);
        keepaliveDraft = content;
        return;
      }
      if (content === baseline) {
        if (state.kind !== "saved") deps.drafts?.clear(); // see runSave: a failed save's draft is stale now
        return;
      }
      const tooLarge = bodyBytes({ content, baseVersion: version, force: false }) > KEEPALIVE_MAX_BYTES;
      if (state.kind === "conflict" || tooLarge) {
        deps.drafts?.write(content, version);
        return;
      }
      void startSave(false, true, content); // writes the draft first, then the keepalive PUT
    },

    unsavedContent() {
      const content = deps.getContent();
      return content === baseline ? null : content;
    },

    retry() {
      if (disposed || state.kind === "conflict") return;
      void startSave(false);
    },

    async keepMine() {
      if (disposed) return;
      if (inFlight) await inFlight;
      await startSave(true);
      if (isFailure(state)) throw currentError();
    },

    adopt(content, newVersion) {
      epoch++;
      clearTimer(timer);
      timer = undefined;
      baseline = content;
      version = newVersion;
      knownVersions.add(newVersion);
      dirtySince = null;
      retryAttempt = 0;
      lastError = null;
      keepaliveDraft = null;
      deps.drafts?.clear();
      setState({ kind: "saved", at: lastSavedAt });
    },

    dispose() {
      disposed = true;
      epoch++;
      clearTimer(timer);
      timer = undefined;
      if (typeof window !== "undefined") window.removeEventListener("online", onOnline);
    },
  };
  return autosaver;
}
