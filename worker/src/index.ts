// Hashly Worker entrypoint — module-worker default export.
//
// Currently implements only the smoke endpoint required by AC 3.9. Subsequent
// ACs will introduce auth, session, and GitHub-proxy routes.
export default {
  async fetch(request: Request, _env: unknown, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health" && request.method === "GET") {
      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  },
};
