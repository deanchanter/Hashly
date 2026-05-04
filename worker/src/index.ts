// Hashly Worker entrypoint — module-worker default export.
import { handleAuthCallback, handleAuthStart } from "./auth";
import type { Env } from "./env";
import { handleGitHubProxy } from "./proxy";

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

    if (url.pathname.startsWith("/api/github/") && request.method === "POST") {
      return handleGitHubProxy(request, env);
    }

    return new Response("not found", { status: 404 });
  },
};
