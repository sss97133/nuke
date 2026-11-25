// deno test --allow-read supabase/functions/_shared/callerDailyCap_test.ts
import { enforceCallerDailyCap, type CapDeps } from "./callerDailyCap.ts";

function assert(c: unknown, m: string): asserts c {
  if (!c) throw new Error(m);
}
const req = new Request("https://x/functions/v1/scrape-vehicle", { method: "POST" });
const NOW = Date.UTC(2026, 10, 25, 15, 0, 0);

function deps(over: Partial<CapDeps> & { who?: { service: boolean; userId: string | null } } = {}) {
  const counts = new Map<string, number>();
  const keys: string[] = [];
  const d: CapDeps = {
    readCap: async () => ({ calls_per_user_per_day: 2 }),
    rpc: (_fn, args) => {
      const k = String(args.p_key);
      keys.push(k);
      counts.set(k, (counts.get(k) ?? 0) + 1);
      return Promise.resolve({ data: counts.get(k)!, error: null });
    },
    now: () => NOW,
    caller: async () => over.who ?? { service: false, userId: "u1" },
    ...over,
  };
  return { d, keys };
}

Deno.test("a user gets the cap's calls a day, then 429 with Retry-After to the UTC day's end", async () => {
  const { d, keys } = deps();
  assert((await enforceCallerDailyCap(req, "scrape-vehicle", d)) === null, "call 1 refused");
  assert((await enforceCallerDailyCap(req, "scrape-vehicle", d)) === null, "call 2 refused");
  const third = await enforceCallerDailyCap(req, "scrape-vehicle", d);
  assert(third?.status === 429, "call 3 not capped");
  assert(third!.headers.get("Retry-After") === String(9 * 3600), "Retry-After is not the seconds to UTC midnight");
  assert(keys[0] === `scrape-vehicle:user:u1:${Date.UTC(2026, 10, 25) / 1000}`, `key ${keys[0]}`);
});

Deno.test("the count is per user", async () => {
  const { d } = deps();
  await enforceCallerDailyCap(req, "scrape-vehicle", d);
  await enforceCallerDailyCap(req, "scrape-vehicle", d);
  const other = { ...d, caller: async () => ({ service: false, userId: "u2" }) };
  assert((await enforceCallerDailyCap(req, "scrape-vehicle", other)) === null, "another user was capped");
});

Deno.test("the service key is not capped and is not counted", async () => {
  const { d, keys } = deps({ who: { service: true, userId: null } });
  for (let i = 0; i < 5; i++) assert((await enforceCallerDailyCap(req, "scrape-vehicle", d)) === null, "service capped");
  assert(keys.length === 0, "service calls were counted");
});

Deno.test("fails closed: no user id, no rule row, unreadable rule row, counter error", async () => {
  assert((await enforceCallerDailyCap(req, "f", deps({ who: { service: false, userId: null } }).d))?.status === 403, "no user id passed");
  assert((await enforceCallerDailyCap(req, "f", deps({ readCap: async () => null }).d))?.status === 503, "no rule row passed");
  assert((await enforceCallerDailyCap(req, "f", deps({ readCap: async () => { throw new Error("x"); } }).d))?.status === 503, "read error passed");
  const rpcErr = deps({ rpc: () => Promise.resolve({ data: null, error: { message: "x" } }) }).d;
  assert((await enforceCallerDailyCap(req, "f", rpcErr))?.status === 503, "counter error passed");
});

Deno.test("scrape-vehicle checks the cap before its first fetch", async () => {
  const src = await Deno.readTextFile(new URL("../scrape-vehicle/index.ts", import.meta.url));
  const handler = src.indexOf("Deno.serve(");
  const cap = src.indexOf("if (capped) return capped;", handler);
  const firstFetch = src.slice(handler).search(/tryFirecrawl(Stealth)?\(|\bfetch\(/);
  assert(cap > handler, "scrape-vehicle has no cap check in its handler");
  assert(firstFetch > 0 && cap < handler + firstFetch, "a fetch runs before the cap check");
});
