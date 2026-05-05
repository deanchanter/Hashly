import { handleSessionStatus } from "../_shared/auth";
import type { Env } from "../_shared/env";

export const onRequestGet: PagesFunction<Env> = async (ctx) => {
  return handleSessionStatus(ctx.request, ctx.env);
};
