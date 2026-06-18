// Node-only auth guard for route handlers. Kept separate from lib/auth.js so the
// Edge middleware never imports next/headers. Reading the session here (instead
// of in middleware) is also what keeps streaming upload bodies from stalling:
// middleware sits in front of the request body and breaks large streamed POSTs.

import { cookies } from "next/headers";
import { SESSION_COOKIE, verifySession } from "./auth";

export async function isAuthed() {
  const token = cookies().get(SESSION_COOKIE)?.value;
  return verifySession(token);
}
