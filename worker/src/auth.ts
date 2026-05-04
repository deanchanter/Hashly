// Auth handlers for the Hashly Worker.
//
// AC 3.4 — `GET /auth/start`: mint a CSRF-bearing `state` nonce, set it as a
// short-lived secure cookie, and 302 the browser to GitHub's install URL.

import type { Env } from "./env";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — short-lived per AC.

/** Parse a `Cookie` request header into a name→value map. */
function parseCookieHeader(header: string | null): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) {
      out[trimmed] = "";
    } else {
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
  }
  return out;
}

/** URL-safe base64 (RFC 4648 §5) of the given bytes, no `=` padding. */
function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Mint a fresh CSRF state nonce — 24 random bytes → 32 char base64url string. */
function mintState(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

export async function handleAuthStart(_request: Request, env: Env): Promise<Response> {
  const state = mintState();
  const slug = env.GITHUB_APP_SLUG;
  const location = `https://github.com/apps/${slug}/installations/new?state=${state}`;

  const setCookie =
    `${STATE_COOKIE_NAME}=${state}` +
    `; HttpOnly` +
    `; Secure` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=${STATE_COOKIE_MAX_AGE_SECONDS}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": setCookie,
    },
  });
}

/**
 * AC 3.5a — CSRF gate for `GET /auth/callback`.
 *
 * Rejects with 400 if the `state` cookie minted at `/auth/start` is missing,
 * empty, or does not match the `state` query param GitHub redirected back
 * with. Returns a fixed error string — never echoes attacker-controlled input.
 */
export async function handleAuthCallback(request: Request, _env: Env): Promise<Response> {
  const url = new URL(request.url);
  const urlState = url.searchParams.get("state");
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const cookieState = cookies[STATE_COOKIE_NAME];

  if (!urlState || !cookieState || urlState !== cookieState) {
    return new Response("invalid state", { status: 400 });
  }

  // Slice 3b will land token exchange + session cookie + redirect here.
  return new Response("ok", { status: 200 });
}
