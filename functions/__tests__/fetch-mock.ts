// Local shim for the `fetchMock` re-export removed from
// `@cloudflare/vitest-pool-workers` in v0.13.0. The original was an
// undici `MockAgent`. We can't import `undici` inside workerd (the test
// isolate crashes on `node:net` etc.), so we re-implement the
// minimal subset of MockAgent / MockPool / MockInterceptor used by the
// ported worker tests, by monkey-patching `globalThis.fetch`.
//
// API surface in use (tests do not exercise more than this):
//   fetchMock.activate()              — no-op (we patch fetch eagerly)
//   fetchMock.disableNetConnect()     — unmocked URLs throw
//   fetchMock.enableNetConnect()      — unmocked URLs pass through
//   fetchMock.get(origin)             — returns a MockPool
//   pool.intercept({path, method})    — returns a MockInterceptor
//                                       (path: string | RegExp, method: string)
//   interceptor.reply(status, body, opts)         — fixed reply
//   interceptor.reply((req) => {statusCode,data,responseOptions})
//                                                  — dynamic reply
//   interceptor.persist()             — match repeatedly
//
// `req` argument to dynamic-reply has shape `{ path, method, body }`
// where `body` is the raw request body (string / ArrayBuffer / Uint8Array).
//
// Match semantics (mirrors undici): origin exact match (URL.origin
// comparison), then for the path either string-equality on
// `pathname + search` OR `RegExp.test(pathname + search)`, then method
// case-insensitive equality.

type ReplyOptions = { headers?: Record<string, string> } | undefined;

type ReplyCallback = (req: {
  path: string;
  method: string;
  body: unknown;
  headers: Record<string, string>;
}) => {
  statusCode: number;
  data: string;
  responseOptions?: ReplyOptions;
};

interface InterceptDescriptor {
  path: string | RegExp;
  method: string;
}

interface RegisteredInterceptor {
  origin: string;
  desc: InterceptDescriptor;
  // EITHER fixedReply OR dynamicReply is set.
  fixed?: { status: number; body: string; opts?: ReplyOptions };
  dynamic?: ReplyCallback;
  persist: boolean;
  consumed: boolean;
}

class MockInterceptor {
  constructor(private readonly _record: RegisteredInterceptor) {}

  reply(
    statusOrCb: number | ReplyCallback,
    body?: string,
    opts?: ReplyOptions,
  ): MockInterceptor {
    if (typeof statusOrCb === "function") {
      this._record.dynamic = statusOrCb;
    } else {
      this._record.fixed = { status: statusOrCb, body: body ?? "", opts };
    }
    return this;
  }

  persist(): MockInterceptor {
    this._record.persist = true;
    return this;
  }
}

class MockPool {
  constructor(
    private readonly _origin: string,
    private readonly _agent: MockAgentShim,
  ) {}

  intercept(desc: InterceptDescriptor): MockInterceptor {
    const record: RegisteredInterceptor = {
      origin: this._origin,
      desc,
      persist: false,
      consumed: false,
    };
    this._agent._register(record);
    return new MockInterceptor(record);
  }
}

class MockAgentShim {
  private _interceptors: RegisteredInterceptor[] = [];
  private _netConnect = true;
  private _patched = false;
  private _originalFetch: typeof fetch | undefined;

  _register(rec: RegisteredInterceptor): void {
    this._interceptors.push(rec);
  }

  activate(): void {
    this._patch();
  }

  disableNetConnect(): void {
    this._netConnect = false;
    this._patch();
  }

  enableNetConnect(): void {
    this._netConnect = true;
  }

  get(origin: string): MockPool {
    this._patch();
    return new MockPool(origin, this);
  }

  private _patch(): void {
    if (this._patched) return;
    this._patched = true;
    this._originalFetch = globalThis.fetch.bind(globalThis);
    const self = this;
    globalThis.fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const req =
        input instanceof Request
          ? new Request(input, init)
          : new Request(input as RequestInfo, init);
      const url = new URL(req.url);
      const origin = url.origin;
      const pathAndQuery = url.pathname + url.search;
      const method = req.method.toUpperCase();

      // Find first non-consumed (or persistent) match.
      for (const rec of self._interceptors) {
        if (rec.origin !== origin) continue;
        if (rec.desc.method.toUpperCase() !== method) continue;
        const p = rec.desc.path;
        const pathMatch =
          typeof p === "string" ? p === pathAndQuery : p.test(pathAndQuery);
        if (!pathMatch) continue;
        if (rec.consumed && !rec.persist) continue;

        if (!rec.persist) rec.consumed = true;

        if (rec.dynamic) {
          // Pass `path` (path+query, mirrors undici), `method`, `body`,
          // `headers`.
          const bodyBuf = await self._readBody(req);
          const headers: Record<string, string> = {};
          req.headers.forEach((value, key) => {
            headers[key.toLowerCase()] = value;
          });
          const out = rec.dynamic({
            path: pathAndQuery,
            method,
            body: bodyBuf,
            headers,
          });
          return new Response(out.data, {
            status: out.statusCode,
            headers: out.responseOptions?.headers,
          });
        }
        if (rec.fixed) {
          return new Response(rec.fixed.body, {
            status: rec.fixed.status,
            headers: rec.fixed.opts?.headers,
          });
        }
      }

      if (!self._netConnect) {
        throw new Error(
          `fetchMock: no interceptor for ${method} ${req.url} and net connect is disabled`,
        );
      }
      return self._originalFetch!(req);
    }) as typeof fetch;
  }

  private async _readBody(req: Request): Promise<unknown> {
    if (req.method === "GET" || req.method === "HEAD") return undefined;
    try {
      // Prefer text — JSON bodies are strings; binary callers can decode.
      const t = await req.clone().text();
      return t;
    } catch {
      try {
        return await req.clone().arrayBuffer();
      } catch {
        return undefined;
      }
    }
  }
}

export const fetchMock = new MockAgentShim();
