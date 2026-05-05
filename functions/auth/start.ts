import { handleAuthStart } from "../_shared/auth";
import type { Env } from "../_shared/env";

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleAuthStart(ctx.request, ctx.env);
};
