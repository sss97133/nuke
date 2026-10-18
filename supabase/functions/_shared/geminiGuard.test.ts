// deno test --allow-env --allow-net=esm.sh supabase/functions/_shared/geminiGuard.test.ts
import { __setGuardDb, geminiFetch, modelOf, parseConfig } from "./geminiGuard.ts";

function equal(actual: unknown, expected: unknown, label = "") {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// Minimal PostgREST-shaped stub: platform_config, llm_cost_tracking
function stubDb(opts: { config?: unknown; calls?: number; blocks?: number; countError?: boolean }) {
  const inserts: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const q: any = { _f: {} as Record<string, unknown> };
      q.select = () => q;
      q.eq = (k: string, v: unknown) => { q._f[k] = v; return q; };
      q.gte = () => q;
      q.maybeSingle = async () => table === "platform_config" ? { data: opts.config === undefined ? null : { config_value: opts.config }, error: null }
        : { data: { id: "row1" }, error: null };
      q.insert = (row: Record<string, unknown>) => { inserts.push(row); return q; };
      q.update = () => q;
      q.then = (ok: (v: unknown) => unknown) => {
        if (q._f.provider === "google_block") return ok({ count: opts.blocks ?? 0, error: null });
        if (opts.countError) return ok({ count: null, error: { message: "boom" } });
        return ok({ count: opts.calls ?? 0, error: null });
      };
      return q;
    },
  };
  return { db, inserts };
}

const URL_ = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=SECRET";

Deno.test("parseConfig defaults to 500 and not paused", () => {
  equal(parseConfig(null), { daily_cap: 500, paused: false });
  equal(parseConfig({ daily_cap: 7, paused: true }), { daily_cap: 7, paused: true });
});

Deno.test("modelOf never includes the key", () => {
  equal(modelOf(URL_), "gemini-2.5-flash-lite");
});

Deno.test("refuses at the daily cap with a 429 and makes no upstream call", async () => {
  const { db, inserts } = stubDb({ config: { daily_cap: 3 }, calls: 3 });
  __setGuardDb(db);
  let upstream = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (() => { upstream++; return Promise.resolve(new Response("{}")); }) as typeof fetch;
  try {
    const r = await geminiFetch(URL_, {}, "test");
    equal(r.status, 429); equal(r.headers.get("x-gemini-guard"), "daily_cap");
    equal(upstream, 0); equal(inserts.length, 0);
  } finally { globalThis.fetch = real; __setGuardDb(null); }
});

Deno.test("allows under the cap, records the call, and passes the response through", async () => {
  const { db, inserts } = stubDb({ config: { daily_cap: 3 }, calls: 2 });
  __setGuardDb(db);
  const real = globalThis.fetch;
  globalThis.fetch = (() => Promise.resolve(new Response('{"ok":1}', { status: 200 }))) as typeof fetch;
  try {
    const r = await geminiFetch(URL_, {}, "test");
    equal(r.status, 200);
    equal(inserts[0], { provider: "google", model: "gemini-2.5-flash-lite", caller: "test", date: new Date().toISOString().slice(0, 10) });
  } finally { globalThis.fetch = real; __setGuardDb(null); }
});

Deno.test("an upstream 429 starts a cooldown: the next call is refused without going out", async () => {
  const { db, inserts } = stubDb({ config: { daily_cap: 100 }, calls: 0 });
  __setGuardDb(db);
  let upstream = 0;
  const real = globalThis.fetch;
  globalThis.fetch = (() => { upstream++; return Promise.resolve(new Response("{}", { status: 429 })); }) as typeof fetch;
  try {
    equal((await geminiFetch(URL_, {}, "test")).status, 429);
    const second = await geminiFetch(URL_, {}, "test");
    equal(second.headers.get("x-gemini-guard"), "cooldown");
    equal(upstream, 1);
    equal(inserts.some((r) => r.provider === "google_block"), true);
  } finally { globalThis.fetch = real; __setGuardDb(null); }
});

Deno.test("paused and unreadable counts both refuse", async () => {
  __setGuardDb(stubDb({ config: { paused: true } }).db);
  equal((await geminiFetch(URL_, {}, "t")).headers.get("x-gemini-guard"), "paused");
  __setGuardDb(stubDb({ config: {}, countError: true }).db);
  const r = await geminiFetch(URL_, {}, "t");
  equal(r.status, 503); equal(r.headers.get("x-gemini-guard"), "unavailable");
  __setGuardDb(null);
});
