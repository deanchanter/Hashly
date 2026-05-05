// Issue #92 fix-loop iter-1 — input validation, size caps, Origin
// gate (fixes #5, #11, #12).
//
// AC for adversarial-reviewer's #5 / #11 / #12:
//
//   #5 (path traversal / write-to-arbitrary-repo) — worker MUST
//   re-validate `repo` / `path` / `ref` / `baseSha` server-side.
//   The frontend's `parseSpecUrl` validators are not a defense
//   for the worker (an attacker can craft a request directly).
//   Without this, an attacker-controlled `path:
//   "../../../OTHER/REPO/contents/secret.md"` would land in the
//   GET-contents fetch URL — the URL parser collapses `..`
//   segments, redirecting the read at a different repo.
//
//   #11 (size caps) — content + commitMessage are unbounded.
//   Cap content at 1 MiB (markdown specs aren't huge); cap
//   commitMessage at 1 KiB and reject CRLF (commit message
//   header injection prevention if any future code splits on
//   newlines).
//
//   #12 (Origin gate) — `/api/save` is a write endpoint and
//   needs the same-origin protection #111 added for /auth
//   endpoints. Without it, a cross-origin POST from an attacker
//   page (with the user's cookie via SameSite=Lax) could spoof
//   saves.
//
// Pinned validation rules (mirror `src/router.ts` parseSpecUrl):
//
//   - repo:           ^[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$
//   - path segments:  no `..`, `.`, or empty; no leading `/`
//   - ref:            ^[A-Za-z0-9._/-]+$ + same segment rules
//   - baseSha:        ^[a-f0-9]{40}$ (lowercase 40-char hex —
//                                     GitHub's git object SHA shape)
//   - content:        max 1 MiB (1,048,576 bytes UTF-8)
//   - commitMessage:  max 1 KiB; no CRLF chars
//
// Pinned Origin rule:
//   - Request's Origin header must equal the request URL's origin.
//     Missing Origin OR Origin from a different host → 403.
//
// On any rejection: status 4xx (400 for bad input, 403 for
// cross-origin), Content-Type: application/json, body
// `{ok: false, kind: 'other', message: <descriptive>}`.

import { SELF, env } from "cloudflare:test";
import { describe, it, expect, beforeEach } from "vitest";

const SESSION_COOKIE_NAME = "hashly_session";
const SESSION_ID = "save-validation-session-32-chars";
const ACCESS_TOKEN = "ghs_validation_test_token_DO_NOT_LEAK";
const VALID_BASE_SHA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

beforeEach(async () => {
  await env.SESSIONS.put(
    SESSION_ID,
    JSON.stringify({
      access_token: ACCESS_TOKEN,
      installation_id: "42",
      expires_at: "2030-01-01T00:00:00Z",
    }),
  );
});

interface SaveBody {
  repo?: unknown;
  path?: unknown;
  ref?: unknown;
  content?: unknown;
  baseSha?: unknown;
  commitMessage?: unknown;
}

const VALID_BODY: Required<Omit<SaveBody, "commitMessage">> = {
  repo: "foo/bar",
  path: "specs/spec.md",
  ref: "main",
  content: "edited content\n",
  baseSha: VALID_BASE_SHA,
};

interface PostSaveOpts {
  origin?: string | null; // null → omit; undefined → default to worker origin
  cookie?: string;
}

async function postSave(
  body: unknown,
  opts: PostSaveOpts = {},
): Promise<Response> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (opts.origin === undefined) {
    headers["Origin"] = "https://worker.test";
  } else if (opts.origin !== null) {
    headers["Origin"] = opts.origin;
  }
  headers["Cookie"] = `${SESSION_COOKIE_NAME}=${opts.cookie ?? SESSION_ID}`;
  return SELF.fetch("https://worker.test/api/save", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function expect4xxStructured(
  res: Response,
  ctx: string,
): Promise<{ ok: false; kind: string; message: string }> {
  expect(
    res.status,
    `${ctx}: expected status 4xx (400 for bad input, 403 for cross-origin). Got ${res.status}.`,
  ).toBeGreaterThanOrEqual(400);
  expect(
    res.status,
    `${ctx}: expected status <500 (validation rejection is a client error). Got ${res.status}.`,
  ).toBeLessThan(500);

  const ct = res.headers.get("content-type") ?? "";
  expect(
    ct.toLowerCase(),
    `${ctx}: expected Content-Type: application/json. Got ${JSON.stringify(ct)}.`,
  ).toContain("application/json");

  let body: { ok?: unknown; kind?: unknown; message?: unknown };
  try {
    body = (await res.json()) as typeof body;
  } catch (e) {
    throw new Error(
      `${ctx}: expected JSON-parseable body. JSON parse threw: ${String(e)}`,
    );
  }
  expect(body.ok, `${ctx}: ok must be false. Got: ${JSON.stringify(body)}`).toBe(false);
  expect(typeof body.kind).toBe("string");
  expect(typeof body.message).toBe("string");
  return body as { ok: false; kind: string; message: string };
}

describe("POST /api/save — repo validation (fix #5)", () => {
  it("rejects an empty repo with a 4xx structured error", async () => {
    const res = await postSave({ ...VALID_BODY, repo: "" });
    await expect4xxStructured(res, "empty repo");
  });

  it('rejects repo without slash ("owner" alone)', async () => {
    const res = await postSave({ ...VALID_BODY, repo: "owner" });
    await expect4xxStructured(res, "no-slash repo");
  });

  it('rejects repo with traversal ("../etc")', async () => {
    // The central #5 attack vector: an attacker-supplied repo with
    // `..` segments would, if interpolated into the GET URL,
    // potentially redirect the fetch via URL normalization.
    const res = await postSave({ ...VALID_BODY, repo: "../etc/passwd" });
    await expect4xxStructured(res, "traversal in repo");
  });

  it("rejects repo with characters outside [A-Za-z0-9._-]", async () => {
    const res = await postSave({ ...VALID_BODY, repo: "owner/repo with spaces" });
    await expect4xxStructured(res, "invalid chars in repo");
  });

  it("rejects repo with three segments", async () => {
    const res = await postSave({ ...VALID_BODY, repo: "a/b/c" });
    await expect4xxStructured(res, "three-segment repo");
  });
});

describe("POST /api/save — path validation (fix #5)", () => {
  it("rejects an empty path", async () => {
    const res = await postSave({ ...VALID_BODY, path: "" });
    await expect4xxStructured(res, "empty path");
  });

  it('rejects path with ".." segment (the central #5 attack vector)', async () => {
    // Without server-side rejection, GitHub URL composition
    // `https://api.github.com/repos/${repo}/contents/${path}` with
    // path="../../OTHER/REPO/contents/secret.md" gets the URL
    // parser to collapse the segments and the worker fetches a
    // DIFFERENT repo than the request claims.
    const res = await postSave({ ...VALID_BODY, path: "../etc/passwd" });
    await expect4xxStructured(res, "traversal in path");
  });

  it('rejects path with "." segment', async () => {
    const res = await postSave({ ...VALID_BODY, path: "specs/./spec.md" });
    await expect4xxStructured(res, "dot segment in path");
  });

  it("rejects path with empty segment (consecutive slashes)", async () => {
    const res = await postSave({ ...VALID_BODY, path: "specs//spec.md" });
    await expect4xxStructured(res, "empty segment in path");
  });

  it("rejects path with leading slash", async () => {
    const res = await postSave({ ...VALID_BODY, path: "/specs/spec.md" });
    await expect4xxStructured(res, "leading slash in path");
  });
});

describe("POST /api/save — ref validation (fix #5)", () => {
  it("rejects empty ref", async () => {
    const res = await postSave({ ...VALID_BODY, ref: "" });
    await expect4xxStructured(res, "empty ref");
  });

  it("rejects ref with semicolon (charset violation)", async () => {
    const res = await postSave({ ...VALID_BODY, ref: "main;rm -rf /" });
    await expect4xxStructured(res, "semicolon in ref");
  });

  it("rejects ref with `..` segment (carry-over of path traversal hardening)", async () => {
    const res = await postSave({ ...VALID_BODY, ref: "feature/../main" });
    await expect4xxStructured(res, "traversal in ref");
  });

  it("rejects ref with question mark / hash (URL-meaningful chars)", async () => {
    const res = await postSave({ ...VALID_BODY, ref: "main?injected=1" });
    await expect4xxStructured(res, "query-meaningful char in ref");
  });
});

describe("POST /api/save — baseSha validation (fix #5)", () => {
  it("rejects baseSha with non-hex characters", async () => {
    const res = await postSave({
      ...VALID_BODY,
      baseSha: "ZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZZ",
    });
    await expect4xxStructured(res, "non-hex baseSha");
  });

  it("rejects baseSha shorter than 40 chars", async () => {
    const res = await postSave({
      ...VALID_BODY,
      baseSha: "aaaaaaaa", // 8 chars
    });
    await expect4xxStructured(res, "short baseSha");
  });

  it("rejects baseSha longer than 40 chars", async () => {
    const res = await postSave({
      ...VALID_BODY,
      baseSha: VALID_BASE_SHA + "extra",
    });
    await expect4xxStructured(res, "long baseSha");
  });

  it("rejects empty baseSha", async () => {
    const res = await postSave({ ...VALID_BODY, baseSha: "" });
    await expect4xxStructured(res, "empty baseSha");
  });
});

describe("POST /api/save — content size cap (fix #11)", () => {
  it("rejects content larger than 1 MiB", async () => {
    // 1.5 MiB is comfortably over any reasonable spec-edit cap.
    // The reject must happen BEFORE the worker tries to base64 the
    // payload — otherwise an attacker can DOS by submitting big
    // payloads that trigger expensive encoding in tight loops.
    const oversized = "x".repeat(1024 * 1024 + 1024); // 1 MiB + 1 KiB
    const res = await postSave({ ...VALID_BODY, content: oversized });
    await expect4xxStructured(res, "oversized content");
  });
});

describe("POST /api/save — commitMessage size cap + CRLF (fix #11)", () => {
  it("rejects commitMessage larger than 1 KiB", async () => {
    const oversized = "y".repeat(1025); // 1 KiB + 1
    const res = await postSave({ ...VALID_BODY, commitMessage: oversized });
    await expect4xxStructured(res, "oversized commitMessage");
  });

  it("rejects commitMessage containing CRLF (\\r\\n)", async () => {
    // Header-injection-class hardening: even though commit messages
    // ride in JSON bodies, a CRLF could downstream become a problem
    // if any code path treats the message as line-oriented.
    const res = await postSave({
      ...VALID_BODY,
      commitMessage: "line one\r\nline two",
    });
    await expect4xxStructured(res, "CRLF in commitMessage");
  });

  it("rejects commitMessage containing a bare \\n (carry-over)", async () => {
    const res = await postSave({
      ...VALID_BODY,
      commitMessage: "line one\nline two",
    });
    await expect4xxStructured(res, "LF in commitMessage");
  });

  it("rejects commitMessage containing a bare \\r (carry-over)", async () => {
    const res = await postSave({
      ...VALID_BODY,
      commitMessage: "line one\rline two",
    });
    await expect4xxStructured(res, "CR in commitMessage");
  });
});

describe("POST /api/save — Origin gate (fix #12)", () => {
  it("rejects request with NO Origin header", async () => {
    // No Origin = browser didn't classify the request as cross-
    // origin (could be same-origin OR a programmatic curl). Same
    // safety floor as the existing /auth Origin gate from #111.
    const res = await postSave(VALID_BODY, { origin: null });
    expect(
      res.status,
      "expected 403 on missing Origin header (fix #12 — same-origin gate floor; without this an attacker page could spoof saves via SameSite=Lax cookie ride-along).",
    ).toBe(403);
  });

  it("rejects request from a DIFFERENT origin (cross-origin attack vector)", async () => {
    const res = await postSave(VALID_BODY, { origin: "https://evil.com" });
    expect(
      res.status,
      "expected 403 on cross-origin POST (fix #12 — central attack vector).",
    ).toBe(403);
  });

  it("accepts request from the worker's OWN origin (matches SELF URL)", async () => {
    // Sanity floor: the gate must not be over-broad. A legitimate
    // same-origin POST proceeds (status will be whatever the rest
    // of the pipeline returns; the test doesn't pin success here,
    // only that it's NOT a 403-from-Origin-gate).
    const res = await postSave(VALID_BODY, { origin: "https://worker.test" });
    expect(
      res.status === 403 ? "BLOCKED-by-Origin" : "passed Origin gate",
      `expected the same-origin request to NOT be 403'd by the Origin gate (fix #12 must not be over-broad). Got status ${res.status}.`,
    ).not.toBe("BLOCKED-by-Origin");
  });
});

describe("POST /api/save — validation precedes any GitHub fetch (defense)", () => {
  it("a malicious-path request never reaches the GitHub-fetch path", async () => {
    // The architecture pin: validation must happen BEFORE any
    // GitHub call. A regression that runs validation AFTER the
    // fetch would still 4xx but would have leaked the bad path
    // upstream. This test would fail in such a case because the
    // mocked GitHub endpoints aren't set up here — an unmocked
    // upstream call would error at undici and the response shape
    // would not match the validation-error shape.
    const res = await postSave({
      ...VALID_BODY,
      path: "../leak/secret.md",
    });
    const body = (await res.json()) as { kind?: string };
    expect(
      body.kind,
      `expected the validation-error shape (kind: 'other'), NOT a GitHub-side error. Without pre-fetch validation, the malicious path would have already been sent to GitHub. Got: ${JSON.stringify(body)}.`,
    ).toBe("other");
  });
});

describe("POST /api/save — happy-path validation precondition", () => {
  it("a fully-valid request passes validation (status is NOT a 4xx-from-validation)", async () => {
    // Cross-pin: ensure the validators don't accidentally reject
    // legitimate inputs. Without this, a regression that tightened
    // the regex too far would pass the negative tests above but
    // break every legitimate save.
    //
    // We don't pin the FINAL status (the GitHub-fetch path isn't
    // mocked here so it'll fail later), only that the 4xx response
    // — if any — does not have kind:'other' WITH a validation-
    // shaped message. A 4xx from a downstream fetch is expected.
    //
    // Safest pin: assert the response is NOT a 400 (the validation
    // error code).
    const res = await postSave(VALID_BODY);
    expect(
      res.status,
      `expected the fully-valid request to NOT be 400'd by validation (precondition that the validators don't over-reject). Got status ${res.status}.`,
    ).not.toBe(400);
  });
});
