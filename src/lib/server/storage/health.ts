import { constants } from "node:fs";
import { access, mkdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { getDataDir } from "./config";
import { randomHex } from "./fs-utils";

/**
 * How long a successful write probe is trusted. /api/health is public and the Docker HEALTHCHECK calls it
 * every 30 s, so writing on every call would churn the notes folder (sync tools, disk spin-down, flash
 * wear). In between, a non-mutating access() check still catches a vanished or unwritable data dir.
 */
export const WRITE_PROBE_TTL_MS = 10 * 60 * 1000;

interface ProbeState {
  /** Per data dir: when the last write probe succeeded. */
  okAt: Map<string, number>;
  /** Per data dir: the probe in progress, so a burst of health checks shares one write. */
  inFlight: Map<string, Promise<void>>;
}
/** On globalThis so dev-mode HMR and duplicate module graphs share one cache. */
const holder = globalThis as typeof globalThis & { __writeHealthProbe?: ProbeState };
const probeState = (): ProbeState => (holder.__writeHealthProbe ??= { okAt: new Map(), inFlight: new Map() });

/** Creates and removes a tiny hidden file: the only reliable test for read-only mounts and uid mismatches. */
async function writeProbe(dataDir: string): Promise<void> {
  await mkdir(dataDir, { recursive: true });
  const probe = path.join(dataDir, `.write-health-${randomHex(4)}.tmp`);
  await writeFile(probe, "ok", { flag: "wx" });
  await unlink(probe);
}

function sharedWriteProbe(dataDir: string): Promise<void> {
  const { inFlight, okAt } = probeState();
  let run = inFlight.get(dataDir);
  if (!run) {
    run = writeProbe(dataDir)
      .then(() => void okAt.set(dataDir, Date.now()))
      .finally(() => inFlight.delete(dataDir));
    inFlight.set(dataDir, run);
  }
  return run;
}

/**
 * Writability probe for /api/health and the Docker HEALTHCHECK. Writes at most once per
 * WRITE_PROBE_TTL_MS (and once per burst of concurrent calls); a failure is never cached, so the next
 * call probes again. Never throws; details go to the server log.
 */
export async function checkHealth(): Promise<{ ok: true } | { ok: false; error: string }> {
  let dataDir: string | undefined;
  try {
    dataDir = getDataDir();
    const okAt = probeState().okAt.get(dataDir);
    if (okAt !== undefined && Date.now() - okAt < WRITE_PROBE_TTL_MS) {
      await access(dataDir, constants.R_OK | constants.W_OK | constants.X_OK);
    } else {
      await sharedWriteProbe(dataDir);
    }
    return { ok: true };
  } catch (err) {
    if (dataDir !== undefined) probeState().okAt.delete(dataDir);
    console.error("[write] Storage health check failed:", err);
    return { ok: false, error: "storage unavailable" };
  }
}
