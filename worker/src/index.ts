// Hashly Worker entrypoint — module-worker default export.
import {
  handleAuthCallback,
  handleAuthLogout,
  handleAuthStart,
  handleSessionStatus,
} from "./auth";
import type { Env } from "./env";
import { handleGitHubProxy } from "./proxy";
import { handleSave } from "./save";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/auth/start" && request.method === "GET") {
      return handleAuthStart(request, env);
    }

    if (url.pathname === "/auth/callback" && request.method === "GET") {
      return handleAuthCallback(request, env);
    }

    if (url.pathname === "/auth/logout" && request.method === "POST") {
      return handleAuthLogout(request, env);
    }

    if (url.pathname === "/api/session-status" && request.method === "GET") {
      return handleSessionStatus(request, env);
    }

    // Issue #91 / AC 5.5 — Relax method guard so the perms-check path
    // (`GET /api/github/repos/{owner}/{repo}`) reaches the proxy. The
    // internal proxy already forwards `request.method` correctly; the
    // auth gate (401 without session) carries through naturally.
    if (url.pathname.startsWith("/api/github/")) {
      return handleGitHubProxy(request, env);
    }

    // Issue #92 / AC 6.7 — `POST /api/save` save endpoint.
    if (url.pathname === "/api/save" && request.method === "POST") {
      return handleSave(request, env);
    }

    return new Response("not found", { status: 404 });
  },
};
