import { hostname, networkInterfaces } from "node:os";
import type { NextConfig } from "next";

/**
 * Hostnames that may load `npm run dev` from another device, such as an iPhone on the same Wi-Fi:
 * this computer's own IPv4 addresses and its Bonjour name (`name.local`). Next.js blocks dev-only
 * resources requested from any other origin, which leaves the page without JavaScript (the editor
 * never loads, buttons do nothing). Add more hostnames, like a tunnel, with a comma-separated
 * WRITE_DEV_ORIGINS. Development only: production ignores `allowedDevOrigins`.
 */
function devOrigins(): string[] {
  const addresses = Object.values(networkInterfaces())
    .flat()
    .flatMap((iface) => (iface && iface.family === "IPv4" && !iface.internal ? [iface.address] : []));
  const name = hostname();
  const extra = (process.env.WRITE_DEV_ORIGINS ?? "").split(",").map((s) => s.trim());
  return [...addresses, name.endsWith(".local") ? name : `${name}.local`, ...extra].filter(Boolean);
}

/** Sent on every response. write has no embeds or third-party content, so these can be strict. */
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "no-referrer" }, // note titles are in URLs
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Docker sets BUILD_STANDALONE=1. Never always-on: standalone server.js chdirs into .next/standalone,
  // so a relative ./data or ./config would land inside the build output (and be wiped by the next build).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  allowedDevOrigins: devOrigins(),
  // Never trace user notes, or write's own settings (API keys), into the build.
  outputFileTracingExcludes: { "/*": ["./data/**/*", "./config/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
