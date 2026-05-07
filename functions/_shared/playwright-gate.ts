// Issue #159 fix-loop / Crit 1 — defense-in-depth gate for the
// Playwright auth stub. The env-var flag (`PLAYWRIGHT_AUTH_STUB`) is
// a single point of failure; if it ever leaks into a production
// deploy, this hostname allowlist refuses to unlock the stub anyway.
//
// Allowed hostnames (local dev + Playwright `webServer`):
//   - `localhost`
//   - `127.0.0.1`
//   - any `*.localhost` host
//
// Anything else — including the canonical prod hostname
// (`hashly-md.pages.dev`), its `www.` variant, and any future custom
// domain — is denied by default.

export function isPlaywrightStubAllowed(
  env: { PLAYWRIGHT_AUTH_STUB?: string },
  request: Request,
): boolean {
  if (env.PLAYWRIGHT_AUTH_STUB !== "1") return false;
  let hostname: string;
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  if (hostname === "localhost") return true;
  if (hostname === "127.0.0.1") return true;
  if (hostname.endsWith(".localhost")) return true;
  return false;
}
