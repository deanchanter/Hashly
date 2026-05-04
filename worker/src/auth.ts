// Auth handlers for the Hashly Worker.
//
// AC 3.4 — `GET /auth/start`: mint a CSRF-bearing `state` nonce, set it as a
// short-lived secure cookie, and 302 the browser to GitHub's install URL.

import type { Env } from "./env";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — short-lived per AC.

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
