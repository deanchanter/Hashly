// Hashly Worker entrypoint — module-worker default export.
import { handleAuthStart } from "./auth";
import type { Env } from "./env";

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    if (url.pathname === "/auth/start" && request.method === "GET") {
      return handleAuthStart(request, env);
    }

    return new Response("not found", { status: 404 });
  },
};
