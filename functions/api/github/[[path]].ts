import { handleGitHubProxy } from "../../_shared/proxy";
import type { Env } from "../../_shared/env";
import { enforceOriginAndMethod, resolveAllowedOrigins } from "../../_shared/origin-gate";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const gate = enforceOriginAndMethod(ctx.request, {
    allowedMethods: ["GET", "POST"],
    allowedOrigins: resolveAllowedOrigins(ctx.env),
  });
  if (gate) return gate;
  return handleGitHubProxy(ctx.request, ctx.env);
};
