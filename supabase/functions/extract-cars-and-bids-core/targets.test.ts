import { retainedEndedCapture } from "./targets.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

// A chainable stand-in for supabase-js: records each call and resolves to the configured result.
function client(result: { data: unknown; error: unknown }, seen: { calls: [string, unknown[]][] }) {
  const q: any = {};
  for (const m of ["select", "in", "eq", "like", "order", "limit"]) q[m] = (...a: unknown[]) => { seen.calls.push([m, a]); return m === "limit" ? Promise.resolve(result) : q; };
  return { from: (t: string) => { seen.calls.push(["from", [t]]); return q; } };
}

Deno.test("an ended capture on file is a free hit and the lookup asks for successful ended pages of both URL spellings", async () => {
  const seen = { calls: [] as [string, unknown[]][] };
  const id = await retainedEndedCapture(client({ data: [{ id: "snap-1" }], error: null }, seen), "https://carsandbids.com/auctions/AbC12345/1988-bmw-m3/");
  eq(id, "snap-1");
  eq(seen.calls.find((c) => c[0] === "in"), ["in", ["listing_url", ["https://carsandbids.com/auctions/AbC12345/1988-bmw-m3", "https://carsandbids.com/auctions/AbC12345/1988-bmw-m3/"]]]);
  eq(seen.calls.find((c) => c[0] === "eq"), ["eq", ["success", true]]);
  eq(seen.calls.find((c) => c[0] === "like"), ["like", ["html", "%bid-bar  ended%"]]);
});

Deno.test("no ended capture, or an unreadable cache, means fetch (never block the lot)", async () => {
  eq(await retainedEndedCapture(client({ data: [], error: null }, { calls: [] }), "https://carsandbids.com/auctions/x/y"), null);
  eq(await retainedEndedCapture(client({ data: null, error: { message: "timeout" } }, { calls: [] }), "https://carsandbids.com/auctions/x/y"), null);
});
