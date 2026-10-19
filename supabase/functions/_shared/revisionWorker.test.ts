import { classifyFailure, recordRevision, reviseRetained } from "./revisionWorker.ts";

const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`${JSON.stringify(a)} != ${JSON.stringify(b)}`); };

Deno.test("failure messages map to a queue reason and next action", () => {
  eq(classifyFailure("Firecrawl HTTP 429: Rate limit exceeded"), { reason: "rate_limited", next: "wait" });
  eq(classifyFailure("extract 500: Vehicle insert failed: duplicate key value"), { reason: "duplicate_key", next: "relink" });
  eq(classifyFailure("Signal timed out."), { reason: "timeout", next: "retry" });
  eq(classifyFailure("insufficient html (12) status 200"), { reason: "parser_gap", next: "reparse_retained" });
});

Deno.test("recordRevision passes the queue arguments and returns the error text", async () => {
  let seen: any = null;
  const ok = { rpc: (fn: string, args: any) => { seen = { fn, args }; return Promise.resolve({ error: null }); } };
  eq(await recordRevision(ok, { url: "u", missing: ["comments"], reason: "thin_landing", next: "refetch", raisedBy: "w" }), null);
  eq([seen.fn, seen.args.p_missing, seen.args.p_next_action], ["record_revision_item", ["comments"], "refetch"]);
  const bad = { rpc: () => Promise.resolve({ error: { message: "boom" } }) };
  eq(await recordRevision(bad, { url: "u", missing: [], reason: "x", next: "y", raisedBy: "w" }), "boom");
});

Deno.test("reviseRetained resolves whole lots, releases the rest, never fetches", async () => {
  const calls: string[] = [];
  const client = {
    rpc: (fn: string, args: any) => {
      calls.push(`${fn}:${args.p_outcome ?? args.p_next_action ?? ""}`);
      if (fn === "claim_revision_items") return Promise.resolve({ data: [{ id: "a", listing_url: "ua" }, { id: "b", listing_url: "ub" }, { id: "c", listing_url: "uc" }], error: null });
      return Promise.resolve({ error: null });
    },
  };
  const r: any = await reviseRetained(client, {
    sourceName: "x", worker: "w", limit: 5,
    reparse: (it) => Promise.resolve(it.id === "a" ? { ok: true, whole: true } : it.id === "b" ? { ok: false, noCapture: true } : { ok: false, detail: { why: "thin" } }),
  });
  eq([r.claimed, r.landed_whole, r.no_capture, r.released], [3, 1, 1, 1]);
  eq(calls, ["claim_revision_items:", "resolve_revision_item:landed_whole", "release_revision_item:refetch", "release_revision_item:wait"]);
});
