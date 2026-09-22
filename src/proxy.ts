import { NextResponse, type NextRequest } from "next/server";
import type { ApiErrorBody } from "@/lib/api-contract";
import { isAuthEnabled, isRequestAuthenticated } from "@/lib/server/auth";
import { loginHref } from "@/lib/routes";

/**
 * Optional auth gate in front of every page and API route (§7.3). With WRITE_PASSWORD unset it lets
 * everything through. Pages redirect to /login (remembering where you were going); API calls get a JSON 401
 * so the client can show "Signed out" instead of following a redirect to HTML.
 * Route handlers and loaders check auth again; this is only the first line of defense.
 */
export function proxy(request: NextRequest): NextResponse | Response {
  if (!isAuthEnabled() || isRequestAuthenticated(request)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  if (pathname === "/api" || pathname.startsWith("/api/")) {
    const body: ApiErrorBody = { error: { code: "unauthorized", message: "Sign in to continue." } };
    return NextResponse.json(body, { status: 401, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.redirect(new URL(loginHref(pathname + search), request.url));
}

export const config = {
  // Everything except static assets, the login page/endpoint and the public health check.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|apple-icon|manifest\\.webmanifest|robots\\.txt|login|api/health|api/auth/login).*)",
  ],
};
