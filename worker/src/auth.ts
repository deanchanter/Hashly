// Auth handlers for the Hashly Worker.
//
// AC 3.4 — `GET /auth/start`: mint a CSRF-bearing `state` nonce, set it as a
// short-lived secure cookie, and 302 the browser to GitHub's install URL.
// AC 3.5 — `GET /auth/callback`: CSRF-gate, exchange the install for an
// access token, store it server-side in KV, and hand the browser back an
// opaque session cookie.

import type { Env } from "./env";

const STATE_COOKIE_NAME = "hashly_oauth_state";
const SESSION_COOKIE_NAME = "hashly_session";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — short-lived per AC.
const SESSION_COOKIE_MAX_AGE_SECONDS = 3600; // 1h — matches GH install token lifetime.

/** Parse a `Cookie` request header into a name→value map. */
export function parseCookieHeader(header: string | null): Record<string, string> {
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

/** Standard base64 → Uint8Array. */
function base64Decode(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Mint a fresh CSRF state / session nonce — 24 random bytes → 32 char base64url. */
function mintNonce(): string {
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return base64UrlEncode(buf);
}

/** Strip PEM armor and base64-decode the inner DER (PKCS#8). */
function pemToPkcs8(pem: string): Uint8Array {
  const body = pem
    .replace(/-----BEGIN [^-]+-----/g, "")
    .replace(/-----END [^-]+-----/g, "")
    .replace(/\s+/g, "");
  return base64Decode(body);
}

/**
 * Build and sign a GitHub App JWT for installation-token exchange.
 * Per GitHub: RS256, claims `{iat, exp, iss}`, `iss` is the App's numeric ID,
 * `iat` may be backdated 60s for clock skew, `exp` ≤ 10 minutes ahead.
 */
async function makeAppJwt(appId: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = { iat: now - 60, exp: now + 9 * 60, iss: appId };
  const enc = new TextEncoder();
  const headerSeg = base64UrlEncode(enc.encode(JSON.stringify(header)));
  const payloadSeg = base64UrlEncode(enc.encode(JSON.stringify(payload)));
  const signingInput = `${headerSeg}.${payloadSeg}`;

  const keyBytes = pemToPkcs8(privateKeyPem);
  const key = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(signingInput));
  const sigSeg = base64UrlEncode(new Uint8Array(sigBuf));
  return `${signingInput}.${sigSeg}`;
}

interface InstallTokenResponse {
  token: string;
  expires_at: string;
}

/** POST to GitHub's installation-token endpoint and return the parsed token. */
async function exchangeInstallationToken(
  installationId: string,
  appJwt: string,
): Promise<InstallTokenResponse> {
  const res = await fetch(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "hashly-worker",
      },
    },
  );
  if (!res.ok) {
    throw new Error(`installation token exchange failed: ${res.status}`);
  }
  return (await res.json()) as InstallTokenResponse;
}

export async function handleAuthStart(_request: Request, env: Env): Promise<Response> {
  const state = mintNonce();
  let location: string;
  if (env.AUTH_METHOD === "oauth-app") {
    const params = new URLSearchParams({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      state,
    });
    location = `https://github.com/login/oauth/authorize?${params.toString()}`;
  } else {
    // Default: `app` (or undefined) — send the user to install the GitHub App.
    location = `https://github.com/apps/${env.GITHUB_APP_SLUG}/installations/new?state=${state}`;
  }

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
 * AC 3.5 — `GET /auth/callback`.
 *
 * 1. CSRF gate: state cookie must be present + non-empty + match URL state.
 * 2. Exchange installation_id for a GH App access token via signed JWT.
 * 3. Mint an opaque session ID, store {access_token, ...} in KV under it.
 * 4. Issue `hashly_session` cookie + clear `hashly_oauth_state`. 302 to "/".
 *
 * The access token NEVER appears in any cookie value or response body.
 */
export async function handleAuthCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const urlState = url.searchParams.get("state");
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const cookieState = cookies[STATE_COOKIE_NAME];

  if (!urlState || !cookieState || urlState !== cookieState) {
    return new Response("invalid state", { status: 400 });
  }

  const installationId = url.searchParams.get("installation_id") ?? "";

  // Exchange the App JWT for an installation access token.
  const appJwt = await makeAppJwt(env.GITHUB_APP_ID, env.GITHUB_APP_PRIVATE_KEY);
  const tokenResponse = await exchangeInstallationToken(installationId, appJwt);

  // Mint an opaque session ID and store the token server-side.
  const sessionId = mintNonce();
  await env.SESSIONS.put(
    sessionId,
    JSON.stringify({
      access_token: tokenResponse.token,
      installation_id: installationId,
      expires_at: tokenResponse.expires_at,
    }),
    { expirationTtl: SESSION_COOKIE_MAX_AGE_SECONDS },
  );

  const sessionCookie =
    `${SESSION_COOKIE_NAME}=${sessionId}` +
    `; HttpOnly` +
    `; Secure` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;

  // Single-use nonce — clear the state cookie now that callback succeeded.
  const clearStateCookie =
    `${STATE_COOKIE_NAME}=` +
    `; HttpOnly` +
    `; Secure` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=0`;

  const headers = new Headers();
  headers.set("Location", "/");
  headers.append("Set-Cookie", sessionCookie);
  headers.append("Set-Cookie", clearStateCookie);

  return new Response(null, { status: 302, headers });
}

/**
 * Issue #91 / AC 5.2 — `GET /api/session-status` is the JIT auth gate.
 *
 * The frontend hits this before flipping into edit mode and branches on
 * the status: 200 → enter edit mode, 401 → redirect to `/auth/start`.
 * Cookie is HttpOnly so JS can't read it directly; the worker is the
 * only authority on whether a live session exists.
 *
 * Pinned invariants:
 *   - empty / missing / unrecognized cookie → 401 (no session)
 *   - cookie maps to a live KV record → 200 with a JSON body
 *   - access token NEVER appears in the response body or any header
 *     (AC 3.10 token-leak invariant carried into this surface)
 *
 * AC 5.4 will enrich the 200 body with `{user: {login, avatar_url}}`
 * for the avatar indicator. For AC 5.2 the minimal viable JSON shape
 * is `{ok: true}` — JSON-parseable so the future enrichment stays
 * additive.
 */
export async function handleSessionStatus(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE_NAME];
  if (!sessionId) {
    return new Response("unauthorized", { status: 401 });
  }
  const record = await env.SESSIONS.get(sessionId);
  if (!record) {
    return new Response("unauthorized", { status: 401 });
  }
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * AC 3.7 — `POST /auth/logout` invalidates the session.
 *
 * Deletes the KV record (if any) AND clears the cookie. Idempotent: callers
 * with no cookie / unknown cookie / empty cookie all get a successful 200.
 * The cleared cookie carries the same security attrs as a live one so the
 * browser will actually overwrite it.
 */
export async function handleAuthLogout(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (sessionId) {
    await env.SESSIONS.delete(sessionId);
  }

  const clearSessionCookie =
    `${SESSION_COOKIE_NAME}=` +
    `; HttpOnly` +
    `; Secure` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=0`;

  return new Response(null, {
    status: 200,
    headers: { "Set-Cookie": clearSessionCookie },
  });
}
