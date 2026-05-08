// Issue #159 / AC 5.4, 5.6 — Playwright auth-stub endpoint.
//
// **CRITICAL guardrail**: this endpoint MUST NEVER respond in production.
// It is gated on `env.PLAYWRIGHT_AUTH_STUB === "1"` — strict string equality,
// not a JS truthy check. Any other value (undefined / "" / "0" / "true" /
// "yes" / "1 " / " 1") yields 404 as if the route did not exist.
//
// When unlocked (only in the Playwright `webServer` env), the handler mints
// a fixture session keyed to the `scenario` query param (one of
// `happy | no-write | conflict | net-fail`), writes it into the SESSIONS KV
// namespace, sets the `hashly_session` cookie with the same security attrs
// as production (`HttpOnly + Secure + SameSite=Lax + Path=/ + Max-Age`), and
// 302-redirects to the validated same-origin `return` URL (default `/`).

import type { Env } from "../_shared/env";
import { isPlaywrightStubAllowed } from "../_shared/playwright-gate";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_COOKIE_MAX_AGE_SECONDS = 3600;

type Scenario = "happy" | "no-write" | "conflict" | "net-fail";

function base64UrlEncode(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function mintSessionId(): string {
  // Crit 3 — `pw__` namespace prefix. Session readers refuse this
  // prefix unless the same gate that mints them is currently allowed.
  const buf = new Uint8Array(24);
  crypto.getRandomValues(buf);
  return `pw__${base64UrlEncode(buf)}`;
}

function fixtureRecord(scenario: Scenario): Record<string, unknown> {
  const baseUser = {
    login: "hashly-e2e-user",
    avatar_url: "https://example.test/avatar.png",
  };
  return {
    access_token: "playwright-fixture-token",
    installation_id: "0",
    expires_at: new Date(Date.now() + SESSION_COOKIE_MAX_AGE_SECONDS * 1000).toISOString(),
    user: baseUser,
    scenario,
  };
}

function validateSameOriginReturn(rawReturn: string | null, requestUrl: string): string {
  if (!rawReturn) return "/";
  try {
    const parsed = new URL(rawReturn, requestUrl);
    const reqOrigin = new URL(requestUrl).origin;
    if (parsed.origin !== reqOrigin) return "/";
    return rawReturn;
  } catch {
    return "/";
  }
}

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;

  if (!isPlaywrightStubAllowed(env, request)) {
    return new Response("not found", { status: 404 });
  }

  const url = new URL(request.url);
  const scenarioRaw = url.searchParams.get("scenario") ?? "happy";
  const scenario: Scenario =
    scenarioRaw === "no-write" ||
    scenarioRaw === "conflict" ||
    scenarioRaw === "net-fail"
      ? scenarioRaw
      : "happy";

  const sessionId = mintSessionId();
  await env.SESSIONS.put(sessionId, JSON.stringify(fixtureRecord(scenario)), {
    expirationTtl: SESSION_COOKIE_MAX_AGE_SECONDS,
  });

  const location = validateSameOriginReturn(url.searchParams.get("return"), request.url);

  const sessionCookie =
    `${SESSION_COOKIE_NAME}=${sessionId}` +
    `; HttpOnly` +
    `; Secure` +
    `; SameSite=Lax` +
    `; Path=/` +
    `; Max-Age=${SESSION_COOKIE_MAX_AGE_SECONDS}`;

  return new Response(null, {
    status: 302,
    headers: {
      Location: location,
      "Set-Cookie": sessionCookie,
    },
  });
};
