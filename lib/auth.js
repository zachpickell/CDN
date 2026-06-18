// Stateless signed-cookie sessions using Web Crypto (HMAC-SHA256).
// Web Crypto is available in both the Edge runtime (middleware) and the
// Node.js runtime (route handlers), so this one implementation works everywhere.

const enc = new TextEncoder();
const dec = new TextDecoder();

export const SESSION_COOKIE = "cdn_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7; // 7 days

function bytesToB64url(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlToBytes(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function getSecret() {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    throw new Error("SESSION_SECRET is not set. Copy .env.local.example to .env.local.");
  }
  return secret;
}

async function getKey() {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(getSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

// Constant-time-ish equality for strings.
function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

export async function createSession() {
  const payload = { exp: Date.now() + SESSION_TTL_MS };
  const data = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return `${data}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifySession(token) {
  if (!token || typeof token !== "string") return false;
  const [data, sig] = token.split(".");
  if (!data || !sig) return false;
  try {
    const key = await getKey();
    const expected = bytesToB64url(
      new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(data)))
    );
    if (!safeEqual(sig, expected)) return false;
    const payload = JSON.parse(dec.decode(b64urlToBytes(data)));
    if (!payload.exp || payload.exp < Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

// Verify the password from the login form against APP_PASSWORD.
export function checkPassword(input) {
  const expected = process.env.APP_PASSWORD;
  if (!expected) {
    throw new Error("APP_PASSWORD is not set. Copy .env.local.example to .env.local.");
  }
  if (typeof input !== "string") return false;
  return safeEqual(input, expected);
}

export const SESSION_MAX_AGE = SESSION_TTL_MS / 1000;
