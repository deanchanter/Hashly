import { handleAuthLogout } from "../_shared/auth";
import type { Env } from "../_shared/env";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  if (ctx.request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }
  return handleAuthLogout(ctx.request, ctx.env);
};
