import http from "node:http";
import https from "node:https";
import { HttpError } from "../http";

/**
 * The one place that calls a harness to start or continue a job (docs/design-decisions.md#d31). Node's
 * http/https rather than fetch, because a self-hosted harness often has a private certificate (Caddy's
 * local authority, say), and trusting one means handing Node its certificate authority, which fetch can't
 * take without a dependency (rule 8). With a trusted authority given, the host name isn't checked:
 * such certificates are often issued for an address inside Docker, and the authority is the owner's own.
 * No redirects are followed, so a key never follows one to another host. Errors name the host, never the
 * key.
 */

export interface HarnessRequest {
  url: URL;
  method: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** PEM of a certificate authority to trust for this server, or "". */
  ca: string;
  timeoutMs?: number;
}

export interface HarnessResponse {
  status: number;
  /** The answer parsed as JSON, or null when it isn't JSON. */
  json: unknown;
  text: string;
}

/** An answer is only read for its data or an error message; anything past this is refused. */
const MAX_RESPONSE_BYTES = 1024 * 1024;

const TLS_CODES = new Set([
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_GET_ISSUER_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "CERT_HAS_EXPIRED",
  "CERT_UNTRUSTED",
]);

/** A connection failure as a message that says what to do about it. */
function unreachable(err: NodeJS.ErrnoException, host: string, customCa: boolean): HttpError {
  const code = err.code ?? "";
  if (TLS_CODES.has(code)) {
    const fix = customCa
      ? "The trusted certificate saved for it didn't match; check that it is the authority that signed the server's certificate."
      : "If it uses a private certificate, add the certificate authority that signed it under Trusted certificate.";
    return new HttpError("harness_unreachable", `${host}'s certificate isn't trusted (${code}). ${fix}`);
  }
  const why: Record<string, string> = {
    ECONNREFUSED: "nothing is listening at that address and port",
    ENOTFOUND: "that host name doesn't resolve",
    EHOSTUNREACH: "the host can't be reached from the write server",
    ETIMEDOUT: "it didn't answer in time",
    ECONNRESET: "the connection was cut",
  };
  return new HttpError("harness_unreachable", `Couldn't reach ${host}: ${why[code] ?? err.message}.`);
}

/** Sends one request and resolves with any answer, 2xx or not; only connection failures throw. */
export function callHarness(req: HarnessRequest): Promise<HarnessResponse> {
  const host = req.url.host;
  const secure = req.url.protocol === "https:";
  const customCa = secure && req.ca.trim() !== "";
  const payload = req.body === undefined ? undefined : JSON.stringify(req.body);
  const headers: Record<string, string | number> = { accept: "application/json", ...req.headers };
  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload);
  }
  const options: https.RequestOptions = { method: req.method, headers, timeout: req.timeoutMs ?? 60_000 };
  if (customCa) {
    options.ca = req.ca;
    options.checkServerIdentity = () => undefined;
  }
  return new Promise((resolve, reject) => {
    const request = (secure ? https : http).request(req.url, options, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) {
          request.destroy();
          reject(new HttpError("harness_error", `${host} sent a larger answer than write accepts.`));
        } else chunks.push(chunk);
      });
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let json: unknown = null;
        try {
          json = JSON.parse(text);
        } catch {
          // not JSON: callers use `text` for the message
        }
        resolve({ status: res.statusCode ?? 0, json, text });
      });
      res.on("error", (err) => reject(unreachable(err, host, customCa)));
    });
    request.on("timeout", () => request.destroy(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })));
    request.on("error", (err) => reject(unreachable(err, host, customCa)));
    if (payload !== undefined) request.write(payload);
    request.end();
  });
}

/** `path` appended to a base URL, trailing slashes ignored. */
export function harnessUrl(base: string, path: string): URL {
  const url = new URL(base.trim());
  url.pathname = url.pathname.replace(/\/+$/, "") + path;
  url.hash = "";
  return url;
}

/** The message of an error answer: its JSON `error` (string or `{ message }`), else the start of its text. */
export function errorMessage(res: HarnessResponse): string {
  const body = res.json as { error?: unknown; message?: unknown; detail?: unknown } | null;
  const e = body?.error;
  const text =
    (typeof e === "string" && e) ||
    (typeof e === "object" && e !== null && typeof (e as { message?: unknown }).message === "string"
      ? (e as { message: string }).message
      : "") ||
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.detail === "string" && body.detail) ||
    res.text.slice(0, 200);
  return text.trim() || `HTTP ${res.status}`;
}
