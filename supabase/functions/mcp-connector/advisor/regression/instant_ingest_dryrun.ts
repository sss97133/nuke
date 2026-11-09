// Read-only dry run of T6 against production data: the lot's URL match is hidden (simulating "not in Nuke"),
// the extract-bat-core call is MOCKED (no write) and "lands" the vehicle that already exists. Shows the
// first-paste answer a just-listed lot gets once the real writer has landed it.
//
//   SUPABASE_SECRET_KEY=... deno run -A supabase/functions/mcp-connector/advisor/regression/instant_ingest_dryrun.ts \
//     <bat lot url> <its existing vehicle id> [mock writer ms = 3331 (extract-bat-core p50, Nov 9 2026)] <out.json>
//
// Pass a writer delay over 10000 to see the timeout → queue path (the queue write is swallowed by readOnlyClient).
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyClient } from "./readonly_client.ts";
import { createAdvisorHandlers } from "../handlers.ts";

const [lotUrl, vid, delayMs, outFile] = [
  Deno.args[0],
  Deno.args[1],
  Number(Deno.args[2] ?? 3331),
  Deno.args[3],
];
const slug = lotUrl.replace(/\/$/, "").split("/").pop()!;
const key = Deno.env.get("SUPABASE_SECRET_KEY")!;
const real = createClient("https://qkgaybvrernstplzjaam.supabase.co", key, {
  auth: { persistSession: false },
});
const ro = readOnlyClient(real, (m) => console.error(m));
// Hide URL-based matches for this lot only.
const hiding = {
  ...ro,
  from(table: string) {
    const b = ro.from(table);
    if (table !== "vehicles") return b;
    let hide = false;
    const wrap = (target: any): any =>
      new Proxy(target, {
        get(t, prop) {
          if (prop === "then") {
            return hide
              ? (res: any) =>
                Promise.resolve({ data: [], error: null }).then(res)
              : t.then.bind(t);
          }
          const v = t[prop];
          if (typeof v !== "function") return v;
          return (...a: unknown[]) => {
            const s = JSON.stringify(a);
            if (
              ["eq", "ilike", "or"].includes(String(prop)) &&
              /listing_url|bat_auction_url/.test(s) && s.includes(slug)
            ) hide = true;
            return wrap(v.apply(t, a));
          };
        },
      });
    return wrap(b);
  },
};
const calls: string[] = [];
const h = createAdvisorHandlers({
  sb: () => hiding,
  callEdgeApi: () => Promise.reject(new Error("edge disabled in dry run")),
  invokeFunction: (name, body) => {
    calls.push(`${name} ${JSON.stringify(body)}`);
    return new Promise((r) =>
      setTimeout(
        () =>
          r({
            status: 200,
            body: { success: true, updated_vehicle_ids: [vid] },
          }),
        delayMs,
      )
    );
  },
});
const t0 = Date.now();
const res = await h.evaluate_listing({ url: lotUrl });
const ms = Date.now() - t0;
const sc = res.structuredContent as any;
await Deno.writeTextFile(outFile, JSON.stringify({ ms, calls, sc }, null, 2));
console.log(JSON.stringify({
  ms,
  calls,
  verdict: sc.verdict,
  ingest: sc.ingest,
  matched: sc.matched_asset_id,
  comps: (sc.comps || []).length,
  value: sc.value && { low: sc.value.low, high: sc.value.high, n: sc.value.n },
  all_in: sc.all_in?.value ?? sc.all_in?.total ?? null,
}));
