import { handleSessionStatus } from "../_shared/auth";
import type { Env } from "../_shared/env";
import { enforceOriginAndMethod, resolveAllowedOrigins } from "../_shared/origin-gate";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const gate = enforceOriginAndMethod(ctx.request, {
    allowedMethods: ["GET"],
    allowedOrigins: resolveAllowedOrigins(ctx.env),
  });
  if (gate) return gate;
  return handleSessionStatus(ctx.request, ctx.env);
};
