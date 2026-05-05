import { handleGitHubProxy } from "../../_shared/proxy";
import type { Env } from "../../_shared/env";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  return handleGitHubProxy(ctx.request, ctx.env);
};
