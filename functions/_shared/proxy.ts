// AC 3.6 — `POST /api/github/*` GitHub API proxy.
//
// Validates the session cookie, looks up the access token in KV, and forwards
// the request to `https://api.github.com<path>` with the token attached as a
// Bearer header. The token is read server-side only — it never appears in any
// header or body returned to the client, and the inbound Cookie header is not
// forwarded upstream.

import { parseCookieHeader } from "./auth";
import type { Env } from "./env";
import { isPlaywrightStubAllowed } from "./playwright-gate";

const SESSION_COOKIE_NAME = "hashly_session";
const PROXY_PREFIX = "/api/github";

interface SessionRecord {
  access_token: string;
  installation_id?: string;
  expires_at?: string;
}

export async function handleGitHubProxy(request: Request, env: Env): Promise<Response> {
  const cookies = parseCookieHeader(request.headers.get("Cookie"));
  const sessionId = cookies[SESSION_COOKIE_NAME];

  if (!sessionId) {
    return new Response("unauthorized", { status: 401 });
  }
  // Crit 3b — pw__ namespace is reserved for the Playwright stub.
  if (sessionId.startsWith("pw__") && !isPlaywrightStubAllowed(env, request)) {
    return new Response("unauthorized", { status: 401 });
  }

  const stored = await env.SESSIONS.get(sessionId);
  if (!stored) {
    return new Response("unauthorized", { status: 401 });
  }

  let session: SessionRecord;
  try {
    session = JSON.parse(stored) as SessionRecord;
  } catch {
    return new Response("unauthorized", { status: 401 });
  }
  if (!session.access_token) {
    return new Response("unauthorized", { status: 401 });
  }

  const inboundUrl = new URL(request.url);
  const upstreamPath = inboundUrl.pathname.slice(PROXY_PREFIX.length);
  const upstreamUrl = `https://api.github.com${upstreamPath}${inboundUrl.search}`;

  // Build outbound headers explicitly. Do NOT copy from the inbound request:
  // the user's session cookie has no business reaching GitHub.
  const upstreamHeaders = new Headers();
  upstreamHeaders.set("Authorization", `Bearer ${session.access_token}`);
  upstreamHeaders.set("Accept", "application/vnd.github+json");
  upstreamHeaders.set("User-Agent", "hashly-worker");
  const inboundContentType = request.headers.get("content-type");
  if (inboundContentType) {
    upstreamHeaders.set("content-type", inboundContentType);
  }

  return fetch(upstreamUrl, {
    method: request.method,
    headers: upstreamHeaders,
    body: request.body,
  });
}
