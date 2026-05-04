// Shared test-only helpers for the Worker test suite.
//
// These are deliberately small and dependency-free so they run inside the
// `workerd` test pool with no extra setup.

/**
 * Parse the *attributes* (not the value) of a single Set-Cookie header into a
 * lowercase-keyed map. Boolean attributes (`HttpOnly`, `Secure`) map to `""`.
 *
 * Example:
 *   parseCookieAttributes("sid=abc; HttpOnly; Secure; SameSite=Lax; Max-Age=600")
 *   → { httponly: "", secure: "", samesite: "Lax", "max-age": "600" }
 *
 * The first segment (the `name=value` pair) is intentionally NOT included;
 * use `parseCookieNameValue` for that.
 */
export function parseCookieAttributes(setCookie: string): Record<string, string> {
  const parts = setCookie.split(";").slice(1).map((p) => p.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const p of parts) {
    const eq = p.indexOf("=");
    if (eq === -1) {
      out[p.toLowerCase()] = "";
    } else {
      out[p.slice(0, eq).toLowerCase()] = p.slice(eq + 1);
    }
  }
  return out;
}

/** Parse the `name=value` pair from a Set-Cookie header. */
export function parseCookieNameValue(setCookie: string): { name: string; value: string } {
  const first = setCookie.split(";")[0] ?? "";
  const eq = first.indexOf("=");
  if (eq === -1) return { name: first, value: "" };
  return { name: first.slice(0, eq).trim(), value: first.slice(eq + 1).trim() };
}

/** Find the first Set-Cookie header whose name matches `cookieName`. */
export function findSetCookie(
  res: Response,
  cookieName: string,
): string | undefined {
  // Workers fetch supports `getSetCookie()` per the Fetch spec.
  const all = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie?.() ?? [];
  return all.find((c) => parseCookieNameValue(c).name === cookieName);
}

/**
 * Assert a Set-Cookie header carries the security attributes required for
 * any session-bearing or CSRF-bearing cookie in this Worker.
 * Throws an `Error` with a useful message if any attribute is missing or wrong.
 */
export function assertSecureCookie(setCookie: string): void {
  const attrs = parseCookieAttributes(setCookie);
  if (!("httponly" in attrs)) throw new Error(`cookie missing HttpOnly: ${setCookie}`);
  if (!("secure" in attrs)) throw new Error(`cookie missing Secure: ${setCookie}`);
  const sameSite = attrs["samesite"];
  if (sameSite?.toLowerCase() !== "lax") {
    throw new Error(`cookie SameSite must be Lax, got ${sameSite}: ${setCookie}`);
  }
  if (!("max-age" in attrs)) throw new Error(`cookie missing Max-Age: ${setCookie}`);
}
