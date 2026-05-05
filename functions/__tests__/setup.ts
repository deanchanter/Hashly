// Per-test setup: reset all bindings (KV, etc.) between tests so
// state from a prior test doesn't leak into the next. Pool 0.x had
// `isolatedStorage` on by default; pool 0.16 dropped that knob, so
// we drive `reset()` explicitly to keep the worker tests' assumed
// per-test isolation.
import { afterEach } from "vitest";
import { reset } from "cloudflare:test";

afterEach(async () => {
  await reset();
});
