import type { HealthResponse } from "@/lib/api-contract";
import { handle, json } from "@/lib/server/http";
import { checkHealth } from "@/lib/server/storage";

/** Public liveness + writability probe (Docker HEALTHCHECK). Never reveals paths. */
export const GET = handle(
  async () => {
    const health = await checkHealth();
    const body: HealthResponse = health.ok ? { ok: true } : { ok: false, error: "storage unavailable" };
    return json(body, health.ok ? 200 : 503);
  },
  { public: true },
);
