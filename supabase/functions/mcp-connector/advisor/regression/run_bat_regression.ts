/**
 * T5 regression harness: 20 fixed BaT URLs through evaluate_listing, scored against goldens read
 * from the BaT page (bat_golden.json).
 *
 * Local (default): runs this checkout's advisor code in-process against live BaT pages and the
 * production database READ-ONLY (see readonly_client.ts; no coverage-log or queue writes).
 *   SUPABASE_SECRET_KEY=... deno run --allow-net --allow-env --allow-read --allow-write \
 *     supabase/functions/mcp-connector/advisor/regression/run_bat_regression.ts [--json out.json]
 * Remote: --remote https://nuke.ag/mcp/advisor  (calls the deployed tool; note the deployed tool
 *   writes one listing_coverage_log row per call, as it does for every caller).
 * Options: --impl <path to advisor dir> (score another checkout, e.g. origin/main for a before run),
 *   --only <substring>, --min-pass 19.
 *
 * A case passes when every golden field matches: title, year, make, model, mileage (+TMU flag),
 * price kind, price, end date; plus no prior sale equal to the subject listing, no "ask" wording
 * for an auction price, and for variant cases every returned comp carries the subject's variant.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { readOnlyClient } from "./readonly_client.ts";

type Golden = {
  url: string;
  result_class: "sold" | "reserve_not_met" | "live";
  title: string;
  year: number;
  make: string;
  model: string;
  mileage: number;
  mileage_tmu: boolean;
  price_kind: "sold" | "high_bid_reserve_not_met" | "current_bid";
  price: number;
  currency: string;
  end_at: string;
  variant_case: boolean;
  audited: boolean;
};

const args = Deno.args;
const opt = (k: string) => {
  const i = args.indexOf(k);
  return i >= 0 ? args[i + 1] : undefined;
};
const remote = opt("--remote");
const impl = opt("--impl");
const only = opt("--only");
const jsonOut = opt("--json");
const minPass = Number(opt("--min-pass") ?? 19);

const here = new URL(".", import.meta.url);
const golden = JSON.parse(
  await Deno.readTextFile(new URL("./bat_golden.json", here)),
) as {
  cases: Golden[];
};
const advisorDir = impl
  ? new URL(`file://${impl.replace(/\/?$/, "/")}`)
  : new URL("../", here);
const { detectVariant } = await import(
  new URL("./variants.ts", new URL("../", here)).href
);

// deno-lint-ignore no-explicit-any
type Tool = (
  a: Record<string, unknown>,
) => Promise<{ structuredContent: any; isError?: boolean }>;
let evaluate: Tool;
const blockedLog: string[] = [];
if (remote) {
  let id = 0;
  evaluate = async (a) => {
    const res = await fetch(remote, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: ++id,
        method: "tools/call",
        params: { name: "evaluate_listing", arguments: a },
      }),
    });
    const text = await res.text();
    const line = text.split("\n").find((l) =>
      l.startsWith("data:")
    )?.slice(5) ?? text;
    const j = JSON.parse(line);
    return {
      structuredContent: j.result?.structuredContent ?? {},
      isError: j.result?.isError,
    };
  };
} else {
  // Secret (sb_secret_*) keys first: the project has legacy JWT keys disabled.
  const key = Deno.env.get("SUPABASE_SECRET_KEY") ||
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!key) {
    throw new Error("set SUPABASE_SECRET_KEY (read-only use) or pass --remote");
  }
  const url = Deno.env.get("SUPABASE_URL") ||
    "https://qkgaybvrernstplzjaam.supabase.co";
  const client = readOnlyClient(
    createClient(url, key, { auth: { persistSession: false } }),
    (m) => blockedLog.push(m),
  );
  // Preflight: a dead key would otherwise look like "no comps" on every case.
  const pre = await client.from("vehicles").select("id").limit(1);
  if (pre.error) {
    throw new Error(`database preflight failed: ${pre.error.message}`);
  }
  const { createAdvisorHandlers } = await import(
    new URL("./handlers.ts", advisorDir).href
  );
  const handlers = createAdvisorHandlers({
    sb: () => client,
    // Vision and edge fallbacks are off in the harness: field and price checks never depend on them.
    callEdgeApi: () =>
      Promise.reject(
        new Error("vision unavailable (harness: edge calls disabled)"),
      ),
  });
  evaluate = handlers.evaluate_listing;
}

const norm = (s: unknown) =>
  String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const canon = (u: unknown) =>
  String(u ?? "").toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(
    /[?#].*$/,
    "",
  ).replace(/\/+$/, "");

// deno-lint-ignore no-explicit-any
function observed(sc: any) {
  const L = sc?.listing ?? {};
  // Old envelopes have no price_kind: a page price shown under `ask` is scored as an ask.
  const kind = L.price_kind ??
    (L.listing_kind === "auction_live"
      ? "current_bid"
      : L.ask != null
      ? "ask"
      : null);
  const price = L.price ??
    (kind === "current_bid"
      ? L.current_bid
      : L.sold_price ?? L.high_bid ?? L.ask) ??
    null;
  return {
    title: L.title ?? null,
    year: L.year ?? null,
    make: L.make ?? null,
    model: L.model ?? null,
    mileage: L.mileage ?? null,
    mileage_tmu: L.mileage_tmu ?? false,
    price_kind: kind,
    price,
    end_at: L.end_at ?? L.auction_end_at ?? null,
  };
}

const results: Array<Record<string, unknown>> = [];
let pass = 0;
let variantFail = 0;
const cases = golden.cases.filter((c) => !only || c.url.includes(only));
for (const g of cases) {
  const t0 = Date.now();
  let sc: Record<string, unknown> = {};
  let error: string | null = null;
  try {
    const r = await evaluate({ url: g.url });
    sc = r.structuredContent ?? {};
    if (r.isError) {
      error = String((sc as Record<string, unknown>).error ?? "tool error");
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const o = observed(sc);
  const fails: string[] = [];
  if (error) fails.push(`error: ${error}`);
  const ended = Date.parse(g.end_at) <= Date.now();
  if (o.title !== g.title) {
    fails.push(
      `title ${JSON.stringify(o.title)} != ${JSON.stringify(g.title)}`,
    );
  }
  if (o.year !== g.year) fails.push(`year ${o.year} != ${g.year}`);
  if (norm(o.make) !== norm(g.make)) fails.push(`make ${o.make} != ${g.make}`);
  if (norm(o.model) !== norm(g.model)) {
    fails.push(
      `model ${JSON.stringify(o.model)} != ${JSON.stringify(g.model)}`,
    );
  }
  if (o.mileage !== g.mileage) {
    fails.push(`mileage ${o.mileage} != ${g.mileage}`);
  }
  if (Boolean(o.mileage_tmu) !== g.mileage_tmu) {
    fails.push(`tmu ${o.mileage_tmu} != ${g.mileage_tmu}`);
  }
  if (g.price_kind === "current_bid" && ended) {
    // A live golden whose auction has since closed: the page now shows a result, not a bid.
    if (!["sold", "high_bid_reserve_not_met"].includes(String(o.price_kind))) {
      fails.push(
        `price_kind ${o.price_kind} (auction ended after capture; expected a result)`,
      );
    }
    if (!(Number(o.price) >= g.price)) {
      fails.push(`price ${o.price} < captured bid ${g.price}`);
    }
  } else {
    if (o.price_kind !== g.price_kind) {
      fails.push(`price_kind ${o.price_kind} != ${g.price_kind}`);
    }
    if (g.price_kind === "current_bid") {
      if (!(Number(o.price) >= g.price)) {
        fails.push(`bid ${o.price} < captured bid ${g.price}`);
      }
    } else if (Number(o.price) !== g.price) {
      fails.push(`price ${o.price} != ${g.price}`);
    }
  }
  if (String(o.end_at ?? "").slice(0, 10) !== g.end_at.slice(0, 10)) {
    fails.push(
      `end ${String(o.end_at).slice(0, 10)} != ${g.end_at.slice(0, 10)}`,
    );
  }
  // T1: the subject listing is never its own prior sale; auction prices are never called an ask.
  const prior = Array.isArray(sc.prior_sales)
    ? sc.prior_sales as Array<Record<string, unknown>>
    : [];
  if (prior.some((p) => canon(p.source_url) === canon(g.url))) {
    fails.push("subject listing appears in prior_sales");
  }
  const verdict = String(sc.verdict ?? "");
  if (/\bask\b/i.test(verdict)) {
    fails.push(`verdict calls an auction price an ask: ${verdict}`);
  }
  // T3: variant cases — every comp carries the subject's variant.
  const comps = Array.isArray(sc.comps)
    ? sc.comps as Array<Record<string, unknown>>
    : [];
  let variantOk: boolean | null = null;
  if (g.variant_case) {
    const want = detectVariant(`${g.model}`);
    const bad = comps.filter((c) =>
      detectVariant(
        `${c.model ?? ""} ${c.title ?? ""} ${c.listing_url ?? ""}`,
      ) !== want
    );
    variantOk = bad.length === 0;
    if (!variantOk) {
      variantFail++;
      fails.push(
        `variant: ${bad.length}/${comps.length} comps not ${want}: ${
          bad.slice(0, 3).map((c) => c.listing_url).join(", ")
        }`,
      );
    }
    if (comps.some((c) => canon(c.listing_url) === canon(g.url))) {
      fails.push("subject listing appears in its own comps");
    }
  }
  const ok = fails.length === 0;
  if (ok) pass++;
  const value = (sc.value ?? {}) as Record<string, unknown>;
  results.push({
    url: g.url,
    class: g.result_class,
    ok,
    fails,
    ms: Date.now() - t0,
    verdict,
    band: [value.low ?? null, value.high ?? null],
    n_comps: comps.length,
    all_in: (sc.all_in as Record<string, unknown> | undefined)?.total ?? null,
    percentile:
      (sc.position as Record<string, unknown> | undefined)?.percentile ?? null,
    trend: sc.trend ?? null,
    observed: o,
  });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${
      g.url.replace("https://bringatrailer.com/listing/", "")
    } (${Date.now() - t0}ms)${ok ? "" : "\n    - " + fails.join("\n    - ")}`,
  );
}
const total = cases.length;
console.log(
  `\nScore: ${pass}/${total} fields-correct · variant-case failures: ${variantFail}` +
    (blockedLog.length
      ? ` · read-only guard: ${[...new Set(blockedLog)].join("; ")}`
      : ""),
);
if (jsonOut) {
  await Deno.writeTextFile(
    jsonOut,
    JSON.stringify({ pass, total, variantFail, results }, null, 2),
  );
}
if (total === golden.cases.length && (pass < minPass || variantFail > 0)) {
  Deno.exit(1);
}
