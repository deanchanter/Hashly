// Issue #156 — Centralized Origin + Method gate.
//
// `enforceOriginAndMethod` returns null when both checks pass, or a
// pre-built rejection Response (403 Origin / 405 method) with empty body
// and `Cache-Control: no-store` so a static-asset fallback can never
// cache or re-skin it (regression hook for #148).
//
// `resolveAllowedOrigins` reads `env.ALLOWED_ORIGINS` (comma-separated)
// and falls back to the prod + local-dev defaults.

const DEFAULT_ALLOWED_ORIGINS = [
  "https://hashly-md.pages.dev",
  "http://localhost:8788",
];

export interface OriginGateOptions {
  allowedMethods: string[];
  allowedOrigins: string[];
}

export function resolveAllowedOrigins(env: { ALLOWED_ORIGINS?: string }): string[] {
  const raw = env?.ALLOWED_ORIGINS;
  if (typeof raw !== "string" || raw.length === 0) {
    return [...DEFAULT_ALLOWED_ORIGINS];
  }
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function originMatches(origin: string, allowed: string[]): boolean {
  for (const entry of allowed) {
    if (entry.startsWith("*.")) {
      const domain = entry.slice(2);
      if (originHostMatchesDomain(origin, domain)) return true;
    } else if (origin === entry) {
      return true;
    }
  }
  return false;
}

function originHostMatchesDomain(origin: string, domain: string): boolean {
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  return host === domain || host.endsWith("." + domain);
}

function rejection(status: number): Response {
  return new Response("", {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export function enforceOriginAndMethod(
  request: Request,
  opts: OriginGateOptions,
): Response | null {
  const origin = request.headers.get("Origin");
  if (origin === null || !originMatches(origin, opts.allowedOrigins)) {
    return rejection(403);
  }
  if (!opts.allowedMethods.includes(request.method)) {
    return rejection(405);
  }
  return null;
}
