import { handleSave } from "../_shared/save";
import type { Env } from "../_shared/env";
import { enforceOriginAndMethod, resolveAllowedOrigins } from "../_shared/origin-gate";

export const onRequest: PagesFunction<Env> = async (ctx) => {
  const gate = enforceOriginAndMethod(ctx.request, {
    allowedMethods: ["POST"],
    allowedOrigins: resolveAllowedOrigins(ctx.env),
  });
  if (gate) return gate;
  return handleSave(ctx.request, ctx.env);
};
