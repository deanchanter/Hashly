import { handleSave } from "../_shared/save";
import type { Env } from "../_shared/env";

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  return handleSave(ctx.request, ctx.env);
};
