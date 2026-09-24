import { NextResponse, type NextRequest } from "next/server";
import { ERROR_STATUS, type ApiErrorBody, type ErrorCode } from "@/lib/api-contract";
import { loginHref, SETUP_HREF } from "@/lib/routes";
import { authenticateRequest, lockoutResponse, type AuthStatus } from "@/lib/server/auth";
import { SETUP_FIRST } from "@/lib/server/http";
import { StorageError } from "@/lib/server/storage";

/**
 * Auth gate in front of every page and API route (see docs/design-decisions.md#d13). With WRITE_AUTH=off it
 * lets everything through. Before first-run setup, pages go to /setup. After it, pages redirect to /login
 * (remembering where you were going); API calls get a JSON 401 (or 429 during a brute-force lockout) so
 * the client can show "Signed out" instead of following a redirect to HTML. If the account file can't be
 * read, nothing gets through: pages go to /login, which explains the problem, and API calls get a 503.
 * Route handlers and loaders check auth again; this is only the first line of defense.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let status: AuthStatus | "unavailable";
  let unavailableMessage = "";
  try {
    status = await authenticateRequest(request);
  } catch (err) {
    if (!(err instanceof StorageError)) throw err;
    status = "unavailable";
    unavailableMessage = err.message;
  }
  if (status === "ok") return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    let code: ErrorCode = "unauthorized";
    let message = "Sign in to continue.";
    if (status === "rate_limited") {
      const lockout = lockoutResponse();
      headers["Retry-After"] = String(lockout.retryAfterS);
      [code, message] = ["rate_limited", lockout.message];
    } else if (status === "setup") {
      message = SETUP_FIRST;
    } else if (status === "unavailable") {
      [code, message] = ["storage_unavailable", unavailableMessage];
    }
    const body: ApiErrorBody = { error: { code, message } };
    return NextResponse.json(body, { status: ERROR_STATUS[code], headers });
  }
  const target = status === "setup" ? SETUP_HREF : loginHref(pathname + search);
  return NextResponse.redirect(new URL(target, request.url));
}

export const config = {
  // Everything except static assets, the sign-in and setup pages and endpoints, and the public health check.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt|login|setup|api/health|api/auth/login|api/auth/setup).*)",
  ],
};
