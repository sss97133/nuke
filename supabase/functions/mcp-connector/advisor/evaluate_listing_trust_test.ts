/**
 * T1–T4 unit checks for evaluate_listing trust fixes (offline; synthetic BaT-shaped HTML).
 * Run: deno test --allow-read supabase/functions/mcp-connector/advisor/evaluate_listing_trust_test.ts
 */
import {
  identityFromTitle,
  parseBatListing,
  parseListingHtml,
  parseMileageLine,
} from "./listing_fetch.ts";
import {
  detectGeneration,
  detectVariant,
  hardVariantMismatch,
  isVariantMismatch,
  junkCompReason,
  lowOutlierCut,
  yearFromListingUrl,
} from "./variants.ts";
import {
  allInCost,
  cohortTrend,
  type FeeRow,
  pricePosition,
} from "./market_position.ts";
import { bandRelation, priceLabel } from "./evaluate_listing.ts";

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function batHtml(
  o: { title: string; info: string; details: string[]; until?: number },
): string {
  return `<html><head><meta property="og:title" content="No Reserve: ${o.title}"/></head><body>
<h1 class="post-title listing-post-title" data-testid="listing-post-title">${o.title}</h1>
<div class="listing-available"><div class="listing-available-info">${o.info}</div></div>
${
    o.until
      ? `<span class="listing-available-countdown" data-countdown="1" data-until="${o.until}"></span>`
      : ""
  }
<div class="item"><strong>Listing Details</strong><ul>${
    o.details.map((d) => `<li>${d}</li>`).join("")
  }</ul></div>
</body></html>`;
}

const SOLD_125 = batHtml({
  title: "1995 Porsche 911 Carrera Coupe",
  info:
    `<span data-listing-currently="1"></span><span class="info-value noborder-tiny">Sold for <strong>USD $64,000</strong> <span class="date date-localize" data-timestamp="1755970301" data-format="L">on 8/23/25</span></span>`,
  details: [
    "Chassis: WP0AA2991SS320160",
    "111k Miles Shown, TMU",
    "3.6-Liter Flat-Six",
    "Four-Speed Tiptronic Automatic Transaxle",
  ],
});

Deno.test("T1: BaT sold page reports a sale (hammer), never an ask", () => {
  const L = parseListingHtml(
    "https://bringatrailer.com/listing/1995-porsche-911-carrera-coupe-125/",
    SOLD_125,
    200,
  );
  assert(L.price_kind === "sold", `kind=${L.price_kind}`);
  assert(L.price === 64000 && L.sold_price === 64000, `price=${L.price}`);
  assert(L.asking_price === null, `ask=${L.asking_price}`);
  assert(L.price_basis === "hammer", `basis=${L.price_basis}`);
  assert(L.currency === "USD", `cur=${L.currency}`);
  assert(L.end_at?.startsWith("2025-08-23") === true, `end=${L.end_at}`);
  assert(
    priceLabel(L.price_kind, L.price, L.end_at) ===
      "sold $64,000 on 2025-08-23",
    "label",
  );
});

Deno.test("T1: reserve-not-met is a high bid, not a sale", () => {
  const html = batHtml({
    title: "17k-Mile 1995 Porsche 911 Carrera Cabriolet",
    info:
      `<span class="info-value noborder-tiny">Bid to <strong>USD $67,118</strong> <span class="date" data-timestamp="1793817807">on 11/4/26</span></span>`,
    details: ["17k Miles"],
  });
  const L = parseListingHtml(
    "https://bringatrailer.com/listing/1995-porsche-911-carrera-cabriolet-203/",
    html,
    200,
  );
  assert(L.price_kind === "high_bid_reserve_not_met", `kind=${L.price_kind}`);
  assert(L.high_bid === 67118 && L.sold_price == null, "high bid only");
  assert(
    /reserve not met \(no sale\)/.test(
      priceLabel(L.price_kind, L.price, L.end_at) || "",
    ),
    "label",
  );
});

Deno.test("T1: live auction is a current bid", () => {
  const until = Math.floor(Date.now() / 1000) + 86_400;
  const html = batHtml({
    title: "1995 Porsche 911 Carrera Cabriolet 6-Speed",
    info:
      `<span data-listing-currently="1"><span class="info-label">Current Bid:</span> <strong class="info-value">USD $39,993</strong></span>`,
    details: ["58k Miles Shown"],
    until,
  });
  const L = parseListingHtml(
    "https://bringatrailer.com/listing/1995-porsche-911-carrera-cabriolet-206/",
    html,
    200,
  );
  assert(
    L.listing_kind === "auction_live" && L.price_kind === "current_bid",
    `${L.listing_kind}/${L.price_kind}`,
  );
  assert(L.current_bid === 39993 && L.asking_price === null, "bid not ask");
  assert(L.model === "911 Carrera Cabriolet", `model=${L.model}`);
});

Deno.test("T2: page odometer with TMU and full model from the title", () => {
  const L = parseListingHtml(
    "https://bringatrailer.com/listing/1995-porsche-911-carrera-coupe-125/",
    SOLD_125,
    200,
  );
  assert(
    L.mileage === 111000 && L.mileage_tmu === true,
    `miles=${L.mileage} tmu=${L.mileage_tmu}`,
  );
  assert(
    L.mileage_source === "page_listing_details",
    `src=${L.mileage_source}`,
  );
  assert(L.model === "911 Carrera Coupe", `model=${L.model}`);
  assert(L.title === "1995 Porsche 911 Carrera Coupe", `title=${L.title}`);
  const km = parseMileageLine("37k Kilometers (~23k Miles) Shown");
  assert(km?.miles === 23000 && km?.km === 37000, JSON.stringify(km));
  assert(parseMileageLine("6,700 Miles")?.miles === 6700, "6,700");
  assert(parseMileageLine("993 Miles")?.miles === 993, "993 miles");
  assert(
    parseMileageLine("3.6-Liter Flat-Six") === null,
    "engine line is not mileage",
  );
  const t = identityFromTitle("993-Mile 2019 Porsche 911 GT2 RS Weissach");
  assert(
    t.year === 2019 && t.make === "Porsche" &&
      t.model === "911 GT2 RS Weissach",
    JSON.stringify(t),
  );
  assert(
    identityFromTitle("2018 Porsche 911 GT3 6-Speed").model === "911 GT3",
    "strip gearbox",
  );
  assert(
    identityFromTitle("1965 Land Rover Series IIA 88").make === "Land Rover",
    "two-word make",
  );
});

Deno.test("T2: '993-Mile' is mileage, not a 993 generation code", () => {
  assert(
    detectGeneration({
      make: "Porsche",
      model: "911 GT2 RS",
      year: 2019,
      text: "993-Mile 2019 Porsche 911 GT2 RS",
    }) === null,
    "2019 overlap stays unknown",
  );
  assert(
    detectGeneration({
      make: "Porsche",
      model: "911 GT3",
      year: 2018,
      text: "993-Mile 2018 Porsche 911 GT3",
    }) === "991",
    "year used",
  );
});

Deno.test("T3: GT3 RS is its own variant; RS / Turbo S / Weissach / Cup must match", () => {
  assert(detectVariant("2011 Porsche 911 GT3 RS") === "gt3_rs", "gt3 rs");
  assert(
    detectVariant(
      "https://bringatrailer.com/listing/2011-porsche-911-gt3-rs-49/",
    ) === "gt3_rs",
    "url gt3-rs",
  );
  assert(detectVariant("2018 Porsche 911 GT3") === "gt3", "gt3");
  assert(detectVariant("2019 Porsche 911 GT2 RS") === "gt2_rs", "gt2 rs");
  assert(
    isVariantMismatch(detectVariant("911 GT3 RS"), detectVariant("911 GT3")),
    "rs vs gt3",
  );
  assert(
    hardVariantMismatch("2011 Porsche 911 GT3 RS", "2011 Porsche 911 GT3")
      .includes("rs"),
    "rs tag",
  );
  assert(
    hardVariantMismatch("911 GT3 RS Weissach", "911 GT3 RS").includes(
      "weissach",
    ),
    "weissach must match",
  );
  assert(
    hardVariantMismatch("911 Turbo", "2005-porsche-911-turbo-s-coupe").includes(
      "turbo_s",
    ),
    "turbo s must match",
  );
  assert(
    hardVariantMismatch(
      "1995 911 Carrera",
      "1995 911 Carrera 17in Cup II Wheels",
    ).length === 0,
    "Cup II wheels are not a Cup car",
  );
  assert(
    hardVariantMismatch("911 GT3", "911 GT3 Cup").includes("cup"),
    "cup car",
  );
  assert(
    hardVariantMismatch(
      "2011 Porsche 911 GT3 RS",
      "https://bringatrailer.com/listing/2011-porsche-911-gt3-rs-47",
    ).length === 0,
    "same",
  );
});

Deno.test("T3: junk comps (bodied, track car, project, parts, URL year) are dropped", () => {
  assert(
    junkCompReason({
      title: "Camaro-Bodied Custom Track Car",
      subjectText: "1967 Chevrolet Camaro Resto Mod",
    }) === "bodied",
    "bodied",
  );
  assert(
    junkCompReason({
      title: "1995 Porsche 911 Project",
      subjectText: "1995 Porsche 911 Carrera",
    }) === "project",
    "project",
  );
  assert(
    junkCompReason({
      title: "1995 Porsche 911 Project",
      subjectText: "1995 Porsche 911 Carrera Project",
    }) === null,
    "subject project keeps project comps",
  );
  assert(
    junkCompReason({
      url: "https://bringatrailer.com/listing/1994-porsche-911-carrera-coupe-7",
      rowYear: 1995,
    }) === "url_year_mismatch",
    "url year",
  );
  assert(
    junkCompReason({
      url: "https://bringatrailer.com/listing/1995-porsche-911-carrera-coupe-7",
      rowYear: 1995,
    }) === null,
    "url year ok",
  );
  assert(
    yearFromListingUrl(
      "https://carsandbids.com/auctions/KD60OD28/1995-porsche-911-turbo-coupe",
    ) === 1995,
    "c&b",
  );
  assert(
    junkCompReason({
      title: "2016 Ford Mustang Shelby GT350 Track Package",
      subjectText: "Mustang",
    }) === null,
    "track package is a car",
  );
  const cut = lowOutlierCut([{ p: 8000 }, { p: 40000 }, { p: 42000 }, {
    p: 45000,
  }], (r) => r.p);
  assert(
    cut.dropped.length === 1 && cut.dropped[0]!.p === 8000,
    "8k < 25% of median dropped",
  );
});

const FEES: FeeRow[] = [
  {
    id: 1,
    platform: "bat",
    role: "buyer",
    fee_kind: "percent",
    rate: 0.05,
    min_amount: 250,
    cap_amount: 5000,
    flat_amount: null,
    currency: "USD",
    published_price_basis: "hammer",
    valid_from: null,
    valid_to: "2024-01-30T06:00:00+00:00",
    source_url: "https://bringatrailer.com/2024/01/26/x/",
    lot_class: "any",
  },
  {
    id: 2,
    platform: "bat",
    role: "buyer",
    fee_kind: "percent",
    rate: 0.05,
    min_amount: 250,
    cap_amount: 7500,
    flat_amount: null,
    currency: "USD",
    published_price_basis: "hammer",
    valid_from: "2024-01-30T06:00:00+00:00",
    valid_to: null,
    source_url: "https://bringatrailer.com/policies/",
    lot_class: "any",
  },
  {
    id: 69,
    platform: "bat",
    role: "buyer",
    fee_kind: "percent",
    rate: 0.1,
    min_amount: 250,
    cap_amount: 4000,
    flat_amount: null,
    currency: "USD",
    published_price_basis: "hammer",
    valid_from: "2025-06-12T07:00:00+00:00",
    valid_to: null,
    source_url: "https://bringatrailer.com/2025/06/12/x/",
    lot_class: "motorcycle",
  },
];

Deno.test("T4: all-in = hammer + cited BaT fee (row in force on the sale date) + transport + paperwork", () => {
  const a = allInCost({
    price: 64000,
    price_kind: "sold",
    price_basis: "hammer",
    currency: "USD",
    platform: "bat",
    at: "2025-08-23T17:31:41Z",
    feeRows: FEES,
    listingUrl: "u",
  });
  assert(
    a.status === "recorded" && a.total === 64000 + 3200 + 1800 + 600,
    JSON.stringify(a),
  );
  const fee = a.buyer_fee as Record<string, unknown>;
  assert(
    (fee.citation as Record<string, unknown>).fee_schedule_id === 2,
    "row 2 cited",
  );
  const capped = allInCost({
    price: 350000,
    price_kind: "current_bid",
    price_basis: "hammer",
    currency: "USD",
    platform: "bat",
    at: "2026-11-09T00:00:00Z",
    feeRows: FEES,
    listingUrl: "u",
  });
  assert(
    (capped.buyer_fee as Record<string, unknown>).amount === 7500,
    "cap 7,500",
  );
  const old = allInCost({
    price: 200000,
    price_kind: "sold",
    price_basis: "hammer",
    currency: "USD",
    platform: "bat",
    at: "2023-05-01T00:00:00Z",
    feeRows: FEES,
    listingUrl: "u",
  });
  assert(
    (old.buyer_fee as Record<string, unknown>).amount === 5000,
    "pre-2024 cap 5,000",
  );
  const unknown = allInCost({
    price: 41000,
    price_kind: "sold",
    price_basis: "unknown",
    currency: "USD",
    platform: "mecum",
    at: "2019-12-01T00:00:00Z",
    feeRows: [],
    listingUrl: "u",
  });
  assert(unknown.status === "not_recorded", "unknown basis is not guessed");
});

Deno.test("T4: percentile among shown comps and 12-month trend with n", () => {
  const comps = [100, 200, 300, 400].map((k) => ({
    sale_price: k * 1000,
    listing_url: `u${k}`,
  }));
  const p = pricePosition(350000, "current_bid", comps);
  assert(p.percentile === 75 && p.n === 4, JSON.stringify(p));
  const now = Date.parse("2026-11-09T00:00:00Z");
  const day = 86_400_000;
  const rows = [
    ...[500, 510, 520].map((k, i) => ({
      sale_price: k * 1000,
      sold_date: new Date(now - (30 + i) * day).toISOString(),
    })),
    ...[400, 410, 420].map((k, i) => ({
      sale_price: k * 1000,
      sold_date: new Date(now - (400 + i) * day).toISOString(),
    })),
  ];
  const t = cohortTrend(rows, now);
  assert(t.status === "recorded" && t.direction === "up", JSON.stringify(t));
  assert(
    (t.window_recent as Record<string, unknown>).n === 3 &&
      (t.window_prior as Record<string, unknown>).n === 3,
    "n",
  );
  assert(
    cohortTrend(rows.slice(0, 3), now).status === "not_recorded_insufficient_n",
    "thin",
  );
  assert(bandRelation(64000, 78000, 110000) === "below", "below");
});
