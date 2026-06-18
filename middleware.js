import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "@/lib/auth";

// Protect the dashboard and the upload/files APIs. Public share links
// (/f/...) and the login flow stay open.
export async function middleware(request) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const valid = await verifySession(token);

  if (!valid) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on the dashboard and protected APIs only.
  matcher: ["/", "/api/upload", "/api/files"],
};
