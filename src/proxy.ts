import { NextResponse, type NextRequest } from "next/server";
import { ERROR_STATUS, type ApiErrorBody } from "@/lib/api-contract";
import { authenticateRequest, lockoutResponse } from "@/lib/server/auth";
import { loginHref } from "@/lib/routes";

/**
 * Optional auth gate in front of every page and API route (see docs/design-decisions.md#d13). With
 * WRITE_PASSWORD unset it lets everything through. Pages redirect to /login (remembering where you were
 * going); API calls get a JSON 401 (or 429 during a brute-force lockout) so the client can show "Signed out"
 * instead of following a redirect to HTML.
 * Route handlers and loaders check auth again; this is only the first line of defense.
 */
export function proxy(request: NextRequest): NextResponse | Response {
  const status = authenticateRequest(request);
  if (status === "ok") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    let message = "Sign in to continue.";
    if (status === "rate_limited") {
      const lockout = lockoutResponse();
      headers["Retry-After"] = String(lockout.retryAfterS);
      message = lockout.message;
    }
    const body: ApiErrorBody = { error: { code: status, message } };
    return NextResponse.json(body, { status: ERROR_STATUS[status], headers });
  }
  return NextResponse.redirect(new URL(loginHref(pathname + search), request.url));
}

export const config = {
  // Everything except static assets, the login page/endpoint and the public health check.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt|login|api/health|api/auth/login).*)",
  ],
};
