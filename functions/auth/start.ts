import { handleAuthStart } from "../_shared/auth";
import type { Env } from "../_shared/env";
import { enforceOriginAndMethod, resolveAllowedOrigins } from "../_shared/origin-gate";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const gate = enforceOriginAndMethod(ctx.request, {
    allowedMethods: ["GET"],
    allowedOrigins: resolveAllowedOrigins(ctx.env),
  });
  if (gate) return gate;
  return handleAuthStart(ctx.request, ctx.env);
};
