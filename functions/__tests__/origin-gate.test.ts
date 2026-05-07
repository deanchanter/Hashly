// Issue #156 — Centralized Origin + Method gate (#103, #111, #148).
//
// `functions/_shared/origin-gate.ts` exports `enforceOriginAndMethod(request, opts)`
// which returns `null` when the request passes both the Origin allowlist
// and the method allowlist, or a `Response` (403 for Origin, 405 for
// method) when it doesn't. Rejections carry `Cache-Control: no-store`
// and an empty body so a static-asset fallback can never re-skin them
// (the bug in #148 where `GET /api/save` rendered the SPA shell).
//
// AC matrix pinned in this file:
//
//   2.1  enforceOriginAndMethod returns null|Response per contract.
//   2.2  env.ALLOWED_ORIGINS (comma-separated) drives the list. Default
//        list applies when unset. `*.hashly-md.pages.dev` suffix-matches.
//   2.4  allowed origin passes / foreign 403 / missing 403 / preview
//        pattern passes / wrong method 405 / supported method passes /
//        rejection has Cache-Control: no-store.
//   2.5  Per-route smoke: POST-with-foreign-origin → 403 on each
//        state-changing handler (/auth/logout, /api/save, /api/github/*).
//   2.6  GET /api/save → 405 (not SPA HTML).

import { exports } from "cloudflare:workers";
import { env } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import {
  enforceOriginAndMethod,
  resolveAllowedOrigins,
} from "../_shared/origin-gate";

const ALLOWED = ["https://hashly-md.pages.dev", "http://localhost:8788"];
const PREVIEW_PATTERN = ["*.hashly-md.pages.dev"];

function makeReq(
  url: string,
  init: { method?: string; origin?: string | null } = {},
): Request {
  const headers = new Headers();
  if (init.origin !== null && init.origin !== undefined) {
    headers.set("Origin", init.origin);
  }
  return new Request(url, { method: init.method ?? "GET", headers });
}

describe("AC 2.1/2.4 — enforceOriginAndMethod contract", () => {
  it("returns null when origin is in allowlist AND method is allowed", () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: "https://hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    expect(
      result,
      "expected null pass-through for allowed origin + allowed method",
    ).toBeNull();
  });

  it("returns 403 Response when Origin header is missing", async () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: null,
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    expect(result, "missing Origin must be rejected").not.toBeNull();
    expect((result as Response).status).toBe(403);
  });

  it("returns 403 Response when Origin is foreign (not in allowlist)", () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: "https://evil.example",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    expect(result, "foreign Origin must be rejected").not.toBeNull();
    expect((result as Response).status).toBe(403);
  });

  it("returns null when Origin matches a wildcard suffix (e.g. *.hashly-md.pages.dev)", () => {
    // Cloudflare Pages preview deployments live at
    // https://<sha>.hashly-md.pages.dev — the gate must accept them
    // via suffix match without re-deploying the env each preview.
    const req = makeReq("https://abc123.hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: "https://abc123.hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: PREVIEW_PATTERN,
    });
    expect(
      result,
      "preview-pattern Origin must pass via *.hashly-md.pages.dev suffix",
    ).toBeNull();
  });

  it("does NOT match wildcard against arbitrary suffix-spoof (security)", () => {
    // `evil-hashly-md.pages.dev` literally ends with `hashly-md.pages.dev`
    // but is a different registrable host. Ensure suffix matching uses
    // a dot-boundary, not naive endsWith.
    const req = makeReq("https://evil-hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: "https://evil-hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: PREVIEW_PATTERN,
    });
    expect(
      result,
      "naive endsWith must not allow `evilhashly-md.pages.dev`-shaped spoofs",
    ).not.toBeNull();
    expect((result as Response).status).toBe(403);
  });

  it("returns 405 Response when method is not in allowedMethods", () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "GET",
      origin: "https://hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    expect(result, "wrong method must be rejected").not.toBeNull();
    expect((result as Response).status).toBe(405);
  });

  it("returns null when method matches one of multiple allowedMethods", () => {
    const req = makeReq("https://hashly-md.pages.dev/api/x", {
      method: "GET",
      origin: "https://hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["GET", "POST"],
      allowedOrigins: ALLOWED,
    });
    expect(result).toBeNull();
  });

  it("403 rejection carries Cache-Control: no-store and an empty body", async () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "POST",
      origin: "https://evil.example",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    const res = result as Response;
    expect(res.status).toBe(403);
    expect(
      res.headers.get("cache-control"),
      "Cache-Control: no-store is required so an asset CDN cannot cache or re-skin the rejection (regression hook for #148).",
    ).toBe("no-store");
    const body = await res.text();
    expect(body, "rejection body must be empty (no SPA HTML)").toBe("");
  });

  it("405 rejection carries Cache-Control: no-store and an empty body", async () => {
    const req = makeReq("https://hashly-md.pages.dev/api/save", {
      method: "GET",
      origin: "https://hashly-md.pages.dev",
    });
    const result = enforceOriginAndMethod(req, {
      allowedMethods: ["POST"],
      allowedOrigins: ALLOWED,
    });
    const res = result as Response;
    expect(res.status).toBe(405);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.text();
    expect(body).toBe("");
  });
});

describe("AC 2.2 — resolveAllowedOrigins(env)", () => {
  it("returns the default list when env.ALLOWED_ORIGINS is unset", () => {
    const list = resolveAllowedOrigins({} as never);
    expect(list).toContain("https://hashly-md.pages.dev");
    expect(list).toContain("http://localhost:8788");
  });

  it("parses a comma-separated env.ALLOWED_ORIGINS, trimming whitespace", () => {
    const list = resolveAllowedOrigins({
      ALLOWED_ORIGINS: "https://a.test, https://b.test ,https://c.test",
    } as never);
    expect(list).toEqual([
      "https://a.test",
      "https://b.test",
      "https://c.test",
    ]);
  });

  it("ignores empty entries from trailing/duplicate commas", () => {
    const list = resolveAllowedOrigins({
      ALLOWED_ORIGINS: "https://a.test,,https://b.test,",
    } as never);
    expect(list).toEqual(["https://a.test", "https://b.test"]);
  });
});

// AC 2.5 — per-route smoke. State-changing routes (POST) must reject
// foreign Origin via the gate. We use `https://evil.example` which is
// NEVER in any environment's allowlist. The intent isn't to retest the
// gate's logic but to confirm each handler is *wired* to it.

describe("AC 2.5 — per-route foreign-origin smoke (state-changing handlers)", () => {
  it("POST /auth/logout from foreign Origin → 403", async () => {
    const res = await (exports as any).default.fetch(
      "https://x.test/auth/logout",
      {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST /api/save from foreign Origin → 403", async () => {
    const res = await (exports as any).default.fetch(
      "https://x.test/api/save",
      {
        method: "POST",
        headers: {
          Origin: "https://evil.example",
          "content-type": "application/json",
        },
        body: JSON.stringify({}),
      },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("POST /api/github/<path> from foreign Origin → 403", async () => {
    const res = await (exports as any).default.fetch(
      "https://x.test/api/github/repos/o/r/contents/spec.md",
      {
        method: "POST",
        headers: { Origin: "https://evil.example" },
      },
    );
    expect(res.status).toBe(403);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

describe("AC 2.6 — GET /api/save returns 405 (closes #148)", () => {
  it("GET /api/save → 405, not SPA HTML", async () => {
    // Pre-#156, GET /api/save fell through the Pages router and hit
    // the SPA-asset fallback, returning index.html with status 200.
    // The gate must own the response so we get a clean 405 instead.
    const res = await (exports as any).default.fetch(
      "https://x.test/api/save",
      {
        method: "GET",
        // Same-origin Origin so this isn't conflated with a 403.
        headers: { Origin: "https://x.test" },
      },
    );
    expect(
      res.status,
      "GET /api/save must be 405; a 200 here means the SPA fallback ate the request again (#148 regression).",
    ).toBe(405);

    const ct = res.headers.get("content-type") ?? "";
    expect(
      /text\/html/i.test(ct),
      `405 must not surface as HTML (got content-type ${JSON.stringify(ct)}). HTML at this path = SPA fallback regression.`,
    ).toBe(false);

    const body = await res.text();
    expect(
      /<!doctype html|<html/i.test(body),
      "405 body must not contain SPA shell markers (regression hook for #148).",
    ).toBe(false);

    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});

// Unused to keep the import side-effect-free; avoids "imported but
// unused" if the builder wires the gate through a helper rather than
// the named export. The named import above doubles as a contract pin
// for AC 2.1 (the export must exist).
void env;
