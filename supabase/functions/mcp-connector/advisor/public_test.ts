// deno test --allow-read supabase/functions/mcp-connector/advisor/public_test.ts
// The advisor's public scope (public.ts): what a caller who is not the service key or an active admin can read,
// write, fetch and see. No network, no database: the client is a recorder.
import {
  isBatListingUrl,
  listingSourceRefusal,
  observationIsPublic,
  publicAnswer,
  publicFlags,
  publicMarkdown,
  publicOnlyClient,
} from "./public.ts";
import { publicDeps } from "./protocol.ts";
import { createAdvisorHandlers } from "./handlers.ts";
import { handleEvaluateListing } from "./evaluate_listing.ts";
import { hardVariantMismatch, hardVariantTags } from "./variants.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

// A PostgREST-shaped recorder: every builder call is logged; awaiting it answers the canned rows.
function recorder(rows: Record<string, unknown[]> = {}) {
  const log: Array<{ table: string; calls: Array<[string, unknown[]]> }> = [];
  const rpcs: string[] = [];
  const client = {
    from(table: string) {
      const entry = { table, calls: [] as Array<[string, unknown[]]> };
      log.push(entry);
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "or", "ilike", "order", "limit", "is", "lte", "gte", "range", "not"]) {
        q[m] = (...args: unknown[]) => {
          entry.calls.push([m, args]);
          return q;
        };
      }
      for (const m of ["insert", "update", "upsert", "delete"]) {
        q[m] = (...args: unknown[]) => {
          entry.calls.push([m, args]);
          return q;
        };
      }
      q.maybeSingle = () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
      q.single = () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
      q.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows[table] ?? [], error: null }).then(res, rej);
      return q;
    },
    rpc(name: string) {
      rpcs.push(name);
      return Promise.resolve({ data: [], error: null });
    },
  };
  return { client, log, rpcs };
}

Deno.test("public client: vehicles reads carry is_public = true; observation reads drop private methods and kinds", async () => {
  const { client, log } = recorder();
  const pub = publicOnlyClient(client);
  await pub.from("vehicles").select("id, vin").eq("id", "x").limit(1);
  await pub.from("vehicle_observations").select("id").eq("vehicle_id", "x");
  await pub.from("vehicle_events").select("id").eq("vehicle_id", "x");
  const v = log.find((e) => e.table === "vehicles")!;
  assert(v.calls.some(([m, a]) => m === "eq" && a[0] === "is_public" && a[1] === true), `vehicles: ${JSON.stringify(v.calls)}`);
  const o = log.find((e) => e.table === "vehicle_observations")!;
  assert(o.calls.some(([m, a]) => m === "in" && a[0] === "kind" && !(a[1] as string[]).includes("work_order")), "observation kinds");
  const orCall = o.calls.find(([m]) => m === "or");
  assert(orCall && String(orCall[1][0]).includes("owner_statement_v1") && String(orCall[1][0]).includes("extraction_method.is.null"),
    `observation methods: ${JSON.stringify(orCall)}`);
  const e = log.find((x) => x.table === "vehicle_events")!;
  assert(!e.calls.some(([m, a]) => m === "eq" && a[0] === "is_public"), "other tables untouched");
});

Deno.test("public client: writes throw and only the read RPCs run (no coverage log, no queue)", async () => {
  const { client, rpcs } = recorder();
  const pub = publicOnlyClient(client);
  for (const m of ["insert", "update", "upsert", "delete"]) {
    let threw = false;
    try {
      pub.from("listing_coverage_log")[m]({});
    } catch {
      threw = true;
    }
    assert(threw, `${m} must throw`);
  }
  const refused = await pub.rpc("log_listing_coverage", {});
  assert(refused.error && refused.data === null, "log_listing_coverage refused");
  await pub.rpc("vehicle_price_facts", {});
  assert(JSON.stringify(rpcs) === JSON.stringify(["vehicle_price_facts"]), `rpcs reaching the db: ${rpcs}`);
});

Deno.test("observationIsPublic mirrors observation_is_public and the private methods", () => {
  assert(observationIsPublic({ kind: "listing", structured_data: { make: "Porsche" } }), "listing");
  assert(!observationIsPublic({ kind: "listing", structured_data: {}, extraction_method: "owner_statement_v1" }), "owner statement");
  assert(!observationIsPublic({ kind: "listing", structured_data: {}, extraction_method: "garage_owner_correction_v1" }), "garage");
  assert(!observationIsPublic({ kind: "work_order", structured_data: {} }), "work order kind");
  assert(!observationIsPublic({ kind: "specification", structured_data: { invoice_number: "1" } }), "invoice key");
  assert(!observationIsPublic({ kind: "listing", structured_data: { seller_name: "A B" } }), "person name");
  assert(!observationIsPublic({ kind: "media", structured_data: { caption: "receipt from shop" } }), "media receipt");
  assert(observationIsPublic({ kind: "condition", structured_data: { note: "clean floors" } }), "condition ok");
});

Deno.test("listing sources: Cars & Bids and Mecum refused for everyone; a visitor gets Bring a Trailer listing pages only", () => {
  const cb = "https://carsandbids.com/auctions/KDwzE4XM/2024-chevrolet-corvette-z06-coupe-2lz";
  const mecum = "https://www.mecum.com/lots/1155668/1966-chevrolet-corvette-convertible/";
  const bat = "https://bringatrailer.com/listing/1982-porsche-911-turbo-12/";
  for (const pub of [true, false]) {
    const a = listingSourceRefusal(cb, pub);
    assert(a?.source === "Cars & Bids" && /only for now/.test(a.message), `C&B public=${pub}`);
    const b = listingSourceRefusal(mecum, pub);
    assert(b?.source === "Mecum" && /only for now/.test(b.message), `Mecum public=${pub}`);
    assert(listingSourceRefusal(bat, pub) === null, `BaT public=${pub}`);
  }
  for (const u of [
    "https://example.com/this-is-not-a-car",
    "https://sfbay.craigslist.org/sfc/cto/d/x/1.html",
    "http://bringatrailer.com/listing/1982-porsche-911-turbo-12/",
    "https://bringatrailer.com/porsche/",
    "https://bringatrailer.com.evil.example/listing/x/",
    "https://169.254.169.254/latest/meta-data/",
  ]) {
    assert(listingSourceRefusal(u, true) !== null, `visitor may not fetch ${u}`);
    assert(!isBatListingUrl(u), `not a BaT listing: ${u}`);
  }
  assert(listingSourceRefusal("https://sfbay.craigslist.org/sfc/cto/d/x/1.html", false) === null, "admin keeps other sources");
  assert(isBatListingUrl("https://www.bringatrailer.com/listing/1971-porsche-911t-coupe-28/"), "www BaT");
});

Deno.test("evaluate_listing refuses Cars & Bids / Mecum before any fetch or read", async () => {
  const realFetch = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    return Promise.reject(new Error("no network in this test"));
  }) as typeof fetch;
  try {
    const deps = {
      sb: () => {
        throw new Error("no database read for a refused source");
      },
      callEdgeApi: () => Promise.reject(new Error("no edge call")),
    };
    for (const [url, pub] of [
      ["https://carsandbids.com/auctions/KDwzE4XM/2024-chevrolet-corvette-z06-coupe-2lz", false],
      ["https://www.mecum.com/lots/1155668/1966-chevrolet-corvette-convertible/", true],
      ["https://example.com/this-is-not-a-car", true],
    ] as Array<[string, boolean]>) {
      const r = await handleEvaluateListing({ ...deps, publicOnly: pub }, { url });
      assert(r.isError === true, `${url}: isError`);
      assert(/Bring a Trailer listings only for now/.test(r.content[0].text), `${url}: ${r.content[0].text}`);
      assert(r.structuredContent.claims.length === 0, `${url}: no claims`);
    }
    assert(fetched === 0, `fetches: ${fetched}`);
  } finally {
    globalThis.fetch = realFetch;
  }
});

Deno.test("public deps: no edge call, public client, publicOnly set", async () => {
  const { client, log } = recorder({ vehicles: [] });
  const deps = publicDeps({ sb: () => client, callEdgeApi: () => Promise.resolve({ data: [] }) });
  assert(deps.publicOnly === true, "publicOnly");
  let rejected = false;
  try {
    await deps.callEdgeApi("vision", "/analyze", "POST", {});
  } catch {
    rejected = true;
  }
  assert(rejected, "edge calls refused");
  // get_asset on a vehicle the public read does not return: not found, and the read asked for is_public.
  const handlers = createAdvisorHandlers(deps);
  const r = await handlers.get_asset({ asset_id: "11111111-1111-4111-8111-111111111111" });
  assert(r.isError || /not found/i.test(JSON.stringify(r.structuredContent)), "private vehicle is not found");
  assert(log.some((e) => e.table === "vehicles" && e.calls.some(([m, a]) => m === "eq" && a[0] === "is_public")), "is_public read");
});

Deno.test("public answer: internal flags mapped or dropped, method/counter keys removed, markdown rewritten", () => {
  const md = [
    "# 1982 Porsche 911 Turbo",
    "## Value",
    "- Basis: value_asset (adjusted_comps) for matched asset 77defae2-3b3b-4435-829f-aa88fa550f26",
    "## Red flags",
    "- shared_value_asset_valuation",
    "- subject_sale_excluded_from_own_valuation",
    "- no_stored_estimate_used_comps",
    "- comps_time_channel_mileage_adjusted",
    "- some_future_internal_flag",
    "- Missing: Service records",
  ].join("\n");
  const raw = {
    content: [{ type: "text" as const, text: md }, { type: "text" as const, text: "{}" }],
    structuredContent: {
      asset_type: "vehicle",
      asset_id: "77defae2-3b3b-4435-829f-aa88fa550f26",
      tool: "evaluate_listing",
      as_of: "2026-11-21T00:00:00Z",
      agent_instructions: "",
      claims: [{
        field: "estimated_value", value: "not recorded", confidence: null, confidence_basis: "none", citations: [],
        checked_sources: ["nuke_estimates", "vehicle_price_facts", "get_comps_combined"],
        note: "Sale basis: hammer; amount from vehicle_price_facts",
      }, {
        field: "fair_value_low", value: 1, confidence: 0.4, confidence_basis: "estimate_model",
        citations: [{ source_name: "platform_fee_schedule", source_url: null, observation_id: null, event_time: null, ingested_at: null, is_superseded: false }],
        note: "value_asset (recent_sold_comps_12m) for matched asset a18b3763-653e-41c5-8799-b4a65e609630",
      }],
      value: { low: 1, high: 2, basis: "value_asset (adjusted_comps) for matched asset 77defae2", flags: ["shared_value_asset_valuation", "recent_12m_sales_override_disagreeing_estimate"] },
      red_flags: ["shared_value_asset_valuation", "TMU: seller states true mileage is unknown", "parts_suspect:low_price"],
      excluded_comps: { variant_mismatch: 4 },
      adjustments: { method: "bt4 backtest 2026-10-22" },
      estimate_source: "adjusted_comps",
      comps_lookup: { ok: true, source: "get_comps_combined" },
      field_conflicts: [{ field: "mileage", page_value: 1, stored_value: 2, stored_source: "vehicles.mileage (77defae2)" }],
      markdown_summary: md,
    },
  };
  const out = publicAnswer(raw);
  const text = JSON.stringify(out);
  for (const internal of [
    "shared_value_asset_valuation", "subject_sale_excluded_from_own_valuation", "no_stored_estimate_used_comps",
    "comps_time_channel_mileage_adjusted", "some_future_internal_flag", "recent_12m_sales_override_disagreeing_estimate",
    "bt4", "excluded_comps", "adjusted_comps", "comps_lookup", "vehicles.mileage", "parts_suspect",
    "vehicle_price_facts", "get_comps_combined", "value_asset (", "platform_fee_schedule", "a18b3763",
  ]) assert(!text.includes(internal), `public answer leaks ${internal}`);
  const sc = out.structuredContent;
  assert(sc.red_flags.includes("TMU: seller states true mileage is unknown"), "readable red flag kept");
  assert(sc.value.flags.includes("Value range comes from the last 12 months of similar sales."), "flag mapped");
  assert(sc.value.low === 1 && sc.value.high === 2, "values kept");
  assert(sc.claims[0].note === "Sale basis: hammer", `note: ${sc.claims[0].note}`);
  assert(out.content[0].text.includes("- Missing: Service records") && out.content[0].text.includes("This car's own sale is not used"), "markdown");
  assert(out.content.length === 2 && JSON.parse(out.content[1].text).markdown_summary === sc.markdown_summary, "content mirrors the envelope");
  assert(publicMarkdown("- Basis: value_asset (x) for matched asset y").includes("Nuke's value for this car"), "basis line");
  assert(JSON.stringify(publicFlags(["a_b_c", "Readable sentence."])) === JSON.stringify(["Readable sentence."]), "unknown id dropped");
});

Deno.test("comps: RUF and swapped-engine cars never comp against stock cars", () => {
  const stockTurbo = "26-Years-Owned, RoW 1982 Porsche 911 Turbo https://bringatrailer.com/listing/1982-porsche-911-turbo-12/";
  assert(hardVariantMismatch(stockTurbo, "1982 Porsche 911 Turbo 5-Speed https://bringatrailer.com/listing/ruf-modified-row-1982-porsche-911-turbo-5-speed").includes("ruf"), "RUF-modified");
  assert(hardVariantMismatch(stockTurbo, "1982 Porsche 911 Turbo https://bringatrailer.com/listing/1982-porsche-ruf-btr-turbo-lightweight").includes("ruf"), "RUF BTR");
  assert(hardVariantMismatch(stockTurbo, "1983 Porsche 911 Turbo https://bringatrailer.com/listing/1983-porsche-930-turbo-21").length === 0, "stock comps stock");
  assert(hardVariantMismatch("RUF CTR Yellowbird", "RUF-Modified 1987 911").length === 0, "RUF comps RUF");
  const ls3 = "LS3-Powered 1997 Land Rover Defender 90 NAS";
  assert(hardVariantMismatch(ls3, "1997 Land Rover Defender 90 NAS").includes("engine_swap"), "swapped vs stock");
  assert(hardVariantMismatch("1997 Land Rover Defender 90 NAS", ls3).includes("engine_swap"), "stock vs swapped");
  assert(hardVariantMismatch(ls3, "LS-Swapped 1997 Land Rover Defender 90").length === 0, "swapped comps swapped");
  assert(hardVariantTags("3.2L-Powered 1971 Porsche 911T Coupe").has("engine_swap"), "3.2L-Powered");
  for (const stock of ["1971 Porsche 911T Coupe 5-Speed", "Twin-Turbocharged 1991 Mazda RX-7", "Rufus Edition 1990 Mazda Miata", "1970 Plymouth Hemi Cuda"]) {
    const tags = hardVariantTags(stock);
    assert(!tags.has("ruf") && !tags.has("engine_swap"), `${stock}: ${[...tags]}`);
  }
});
