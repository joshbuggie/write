import { clearSessionCookie } from "@/lib/server/auth";
import { handle, noContent } from "@/lib/server/http";

/** Sign out this browser by clearing the session cookie. Other devices stay signed in. */
export const POST = handle(async () => noContent({ "Set-Cookie": clearSessionCookie() }));
