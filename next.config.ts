import type { NextConfig } from "next";

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
  // so a relative ./data would land inside the build output (and be wiped by the next build).
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  poweredByHeader: false,
  outputFileTracingExcludes: { "/*": ["./data/**/*"] }, // never trace user notes into the build
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
