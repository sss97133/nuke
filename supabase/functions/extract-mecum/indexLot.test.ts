import { extractStructuredLotFacets, indexLot, parseSaleFacet } from "./indexLot.ts";

// Records as Mecum's public index returns them (Algolia wp_posts_lot, pulled 2026-10-15), trimmed of highlight fields.
const FIXTURE: any[] = [{"post_id": 659101, "post_title": "Chevrolet OK Used Cars Double-Sided Tin Flange", "post_modified": 1736777109, "permalink": "/lots/1139600/chevrolet-ok-used-cars-double-sided-tin-flange/", "taxonomies": {"auction_tax": [{"name": "Kissimmee 2025|1736208000|1737244800", "slug": "kissimmee-2025", "term_id": 221940}], "collection_tax": [{"name": "Geri Bauer's Forest Park Car Collection from Bridgehampton, New York|-97|0", "slug": "geri-bauers-forest-park-car-collection-from-bridgehampton-new-york", "term_id": 226469}], "division_tax": [{"name": "Road Art", "slug": "road-art", "term_id": 1576}], "lot_status": [{"name": "General", "slug": "general", "term_id": 192990}, {"name": "No reserve", "slug": "no-reserve", "term_id": 19}], "lot_type": [{"name": "Road Art", "slug": "road-art", "term_id": 1577}], "make": [{"name": "Chevrolet OK", "slug": "chevrolet-ok", "term_id": 125813}], "make_model": [{"name": "Chevrolet OK", "slug": "chevrolet-ok", "term_id": 1864}, {"name": "Road Art", "slug": "road-art", "term_id": 1578}, {"name": "Used Cars Double-Sided Tin Flange", "slug": "used-cars-double-sided-tin-flange", "term_id": 231450}], "model": [{"name": "Used Cars Double-Sided Tin Flange", "slug": "used-cars-double-sided-tin-flange", "term_id": 231451}], "run_date": [{"name": "2025-01-13", "timestamp": 1736726400, "slug": "2025-01-13", "term_id": 226381}], "sale_result": [{"name": "sold", "slug": "sold", "term_id": 85405}]}, "web_id_meta": "1139600", "auction_end_date_meta": 1737244800, "auction_day_start_meta": "2025-01-13 06:00:00", "lot_number_meta": "Y353", "sold": 1, "bid_goes_on": 0, "highest_bid_or_price": 1416, "objectID": "659101-0"}, {"post_id": 656603, "post_title": "1975 Ford F100 Pickup", "post_modified": 1736796364, "permalink": "/lots/1139314/1975-ford-f100-pickup/", "taxonomies": {"auction_tax": [{"name": "Kissimmee 2025|1736208000|1737244800", "slug": "kissimmee-2025", "term_id": 221940}], "body_type": [{"name": "Pickup", "slug": "pickup", "term_id": 724}], "division_tax": [{"name": "Collector Cars", "slug": "collector-cars", "term_id": 17}], "lot_status": [{"name": "General", "slug": "general", "term_id": 192990}], "lot_tag": [{"name": "1970s", "slug": "1970s", "term_id": 195825}, {"name": "Pickup", "slug": "pickup", "term_id": 195986}], "lot_type": [{"name": "Auto", "slug": "auto", "term_id": 20}], "lot_year": [{"name": 1975, "slug": "1975", "term_id": 891}], "make": [{"name": "Ford", "slug": "ford", "term_id": 85412}], "make_model": [{"name": "Collector Cars", "slug": "collector-cars", "term_id": 718}, {"name": "F100", "slug": "f100", "term_id": 979}, {"name": "Ford", "slug": "ford", "term_id": 731}], "model": [{"name": "F100", "slug": "f100", "term_id": 119606}], "run_date": [{"name": "2025-01-13", "timestamp": 1736726400, "slug": "2025-01-13", "term_id": 226381}], "sale_result": [{"name": "sold", "slug": "sold", "term_id": 85405}]}, "web_id_meta": "1139314", "auction_end_date_meta": 1737244800, "auction_day_start_meta": "2025-01-13 06:00:00", "lot_number_meta": "M261", "sold": 1, "bid_goes_on": 0, "highest_bid_or_price": 30800, "objectID": "656603-0"}, {"post_id": 653683, "post_title": "1973 Jeepster Commando SUV", "post_modified": 1736795686, "permalink": "/lots/1139290/1973-jeepster-commando-suv/", "taxonomies": {"auction_tax": [{"name": "Kissimmee 2025|1736208000|1737244800", "slug": "kissimmee-2025", "term_id": 221940}], "body_type": [{"name": "SUV", "slug": "suv", "term_id": 198626}], "division_tax": [{"name": "Collector Cars", "slug": "collector-cars", "term_id": 17}], "lot_status": [{"name": "General", "slug": "general", "term_id": 192990}], "lot_tag": [{"name": "1970s", "slug": "1970s", "term_id": 195825}], "lot_type": [{"name": "Auto", "slug": "auto", "term_id": 20}], "lot_year": [{"name": 1973, "slug": "1973", "term_id": 881}], "make": [{"name": "Jeepster", "slug": "jeepster", "term_id": 85928}], "make_model": [{"name": "Collector Cars", "slug": "collector-cars", "term_id": 718}, {"name": "Commando", "slug": "commando", "term_id": 2055}, {"name": "Jeepster", "slug": "jeepster", "term_id": 1484}], "model": [{"name": "Commando", "slug": "commando", "term_id": 125613}], "run_date": [{"name": "2025-01-13", "timestamp": 1736726400, "slug": "2025-01-13", "term_id": 226381}], "sale_result": [{"name": "bid-goes-on", "slug": "bid-goes-on", "term_id": 85406}]}, "web_id_meta": "1139290", "auction_end_date_meta": 1737244800, "auction_day_start_meta": "2025-01-13 06:00:00", "lot_number_meta": "M257", "sold": 0, "bid_goes_on": 1, "highest_bid_or_price": 17000, "objectID": "653683-0"}, {"post_id": 653723, "post_title": "2005 Harley-Davidson Night Train", "post_modified": 1736793015, "permalink": "/lots/1138691/2005-harley-davidson-night-train/", "taxonomies": {"auction_tax": [{"name": "Kissimmee 2025|1736208000|1737244800", "slug": "kissimmee-2025", "term_id": 221940}], "division_tax": [{"name": "Motorcycles", "slug": "motorcycles", "term_id": 747}], "lot_status": [{"name": "General", "slug": "general", "term_id": 192990}], "lot_tag": [{"name": "2000s", "slug": "2000s", "term_id": 195959}, {"name": "Motorcycle", "slug": "motorcycle", "term_id": 196607}], "lot_type": [{"name": "Motorcycle", "slug": "motorcycle", "term_id": 748}], "lot_year": [{"name": 2005, "slug": "2005", "term_id": 801}], "make": [{"name": "Harley-Davidson", "slug": "harley-davidson", "term_id": 85796}], "make_model": [{"name": "Harley-Davidson", "slug": "harley-davidson", "term_id": 750}, {"name": "Motorcycles", "slug": "motorcycles", "term_id": 749}, {"name": "Night Train", "slug": "night-train", "term_id": 73664}], "model": [{"name": "Night Train", "slug": "night-train", "term_id": 90214}], "run_date": [{"name": "2025-01-13", "timestamp": 1736726400, "slug": "2025-01-13", "term_id": 226381}], "sale_result": [{"name": "sold", "slug": "sold", "term_id": 85405}]}, "web_id_meta": "1138691", "auction_end_date_meta": 1737244800, "auction_day_start_meta": "2025-01-13 06:00:00", "lot_number_meta": "M214", "sold": 1, "bid_goes_on": 0, "highest_bid_or_price": 3300, "objectID": "653723-0"}];

const byType = (t: string) => FIXTURE.find((h) => h.taxonomies.lot_type?.[0]?.name === t);

Deno.test("a sold Auto lot becomes a lot with its hammer, run day, sale and rich Algolia metadata", () => {
  const hit = structuredClone(FIXTURE.find((h) => h.sold === 1 && h.taxonomies.lot_type?.[0]?.name === "Auto"));
  hit.color_meta = "Blue";
  hit.interior_meta = "Blue";
  hit.transmission_type_meta = "4-Speed Manual";
  hit.lot_series_meta = "V-Code 440 6-BBL, 4-Speed";
  hit.images_meta = [{ url: "https://cdn1.mecum.com/auctions/fl23/fl23_f142_1.jpg" }];
  const r: any = indexLot(hit);
  if (!r.lot) throw new Error(JSON.stringify(r));
  if (r.lot.result !== "sold" || r.lot.price !== hit.highest_bid_or_price) throw new Error(JSON.stringify(r.lot));
  if (!r.lot.url.startsWith("https://www.mecum.com/lots/") || !r.lot.url.endsWith("/")) throw new Error(r.lot.url);
  if (!r.lot.sale_key || !/^\d{4}-\d{2}-\d{2}$/.test(r.lot.sale_starts_on)) throw new Error(JSON.stringify(r.lot));
  if (r.lot.exterior_color !== "Blue" || r.lot.interior_color !== "Blue" || r.lot.transmission !== "4-Speed Manual") {
    throw new Error(JSON.stringify(r.lot));
  }
  if (r.lot.engine !== "V-Code 440 6-BBL, 4-Speed" || r.lot.image_urls[0] !== "https://cdn1.mecum.com/auctions/fl23/fl23_f142_1.jpg") {
    throw new Error(JSON.stringify(r.lot));
  }
  if (r.lot.body_style !== "Pickup") {
    throw new Error(JSON.stringify(r.lot));
  }
});

Deno.test("indexLot reads hammer_price_meta, run_date timestamps, trim, engine_configuration and estimates", () => {
  const hit = structuredClone(FIXTURE.find((h) => h.sold === 1 && h.taxonomies.lot_type?.[0]?.name === "Auto"));
  delete hit.highest_bid_or_price;
  hit.hammer_price_meta = 148500;
  hit.low_estimate_meta = 125000;
  hit.high_estimate_meta = 150000;
  hit.engine_configuration_meta = "V-8";
  hit.taxonomies.run_date = [{ name: "2019-05-17 00:00:00", slug: "2019-05-17" }];
  hit.taxonomies.trim_sub_model = [{ name: "Hemi", slug: "hemi" }];
  hit.taxonomies.body_type = [{ name: "Hardtop", slug: "hardtop" }];
  const r: any = indexLot(hit);
  if (!r.lot) throw new Error(JSON.stringify(r));
  if (r.lot.price !== 148500) throw new Error(`expected hammer_price_meta 148500, got ${r.lot.price}`);
  if (r.lot.run_day !== "2019-05-17") throw new Error(`expected run_day 2019-05-17, got ${r.lot.run_day}`);
  if (r.lot.trim !== "Hemi" || r.lot.body_style !== "Hardtop" || r.lot.engine_configuration !== "V-8") {
    throw new Error(JSON.stringify(r.lot));
  }
  if (r.lot.estimate_low !== 125000 || r.lot.estimate_high !== 150000) {
    throw new Error(JSON.stringify(r.lot));
  }
});

Deno.test("indexLot and extractStructuredLotFacets extract Squarebody C10/K10/C20/K20, Silverado, Cheyenne Super, Scottsdale, Stepside/Fleetside, and Mustang Fastback/Mach 1/Boss 302", () => {
  const baseHit = structuredClone(FIXTURE.find((h) => h.sold === 1 && h.taxonomies.lot_type?.[0]?.name === "Auto"));

  // 1. 1978 Chevrolet K10 Cheyenne Super Stepside Pickup
  const k10Hit = structuredClone(baseHit);
  k10Hit.post_title = "1978 Chevrolet K10 Cheyenne Super Stepside Pickup";
  k10Hit.lot_series_meta = "400 CI V-8, Automatic, 4WD";
  k10Hit.taxonomies.lot_year = [{ name: 1978, slug: "1978" }];
  k10Hit.taxonomies.make = [{ name: "Chevrolet", slug: "chevrolet" }];
  k10Hit.taxonomies.model = [{ name: "K10", slug: "k10" }];
  k10Hit.taxonomies.body_type = [{ name: "Pickup", slug: "pickup" }];
  const k10Res: any = indexLot(k10Hit);
  if (
    k10Res.lot.series !== "K10" ||
    k10Res.lot.trim !== "Cheyenne Super" ||
    k10Res.lot.body_style !== "Stepside Pickup"
  ) {
    throw new Error(`unexpected K10 facets: ${JSON.stringify(k10Res.lot)}`);
  }

  // 2. 1985 Chevrolet C10 Silverado Fleetside (trim in highlights when title omits it)
  const c10Hit = structuredClone(baseHit);
  c10Hit.post_title = "1985 Chevrolet C10 Fleetside Pickup";
  c10Hit.lot_series_meta = "Silverado Package, 350 CI V-8, Automatic";
  c10Hit.taxonomies.lot_year = [{ name: 1985, slug: "1985" }];
  c10Hit.taxonomies.make = [{ name: "Chevrolet", slug: "chevrolet" }];
  c10Hit.taxonomies.model = [{ name: "C10", slug: "c10" }];
  c10Hit.taxonomies.body_type = [{ name: "Pickup", slug: "pickup" }];
  const c10Res: any = indexLot(c10Hit);
  if (
    c10Res.lot.series !== "C10" ||
    c10Res.lot.trim !== "Silverado" ||
    c10Res.lot.body_style !== "Fleetside Pickup"
  ) {
    throw new Error(`unexpected C10 facets: ${JSON.stringify(c10Res.lot)}`);
  }

  // 3. 1979 Chevrolet C20 Scottsdale & K20 Custom Deluxe
  const c20Facets = extractStructuredLotFacets({
    year: 1979,
    make: "Chevrolet",
    model: "C20",
    title: "1979 Chevrolet C20 Scottsdale Camper Special",
  });
  if (c20Facets.series !== "C20" || c20Facets.trim !== "Scottsdale") {
    throw new Error(`unexpected C20 facets: ${JSON.stringify(c20Facets)}`);
  }
  const k20Facets = extractStructuredLotFacets({
    year: 1976,
    make: "Chevrolet",
    model: "K20",
    title: "1976 Chevrolet K20 Custom Deluxe 4x4 Pickup",
  });
  if (k20Facets.series !== "K20" || k20Facets.trim !== "Custom Deluxe" || k20Facets.body_style !== "Pickup") {
    throw new Error(`unexpected K20 facets: ${JSON.stringify(k20Facets)}`);
  }

  // 4. Mustang Mach 1 Fastback & Boss 302 Fastback
  const mach1Hit = structuredClone(baseHit);
  mach1Hit.post_title = "1969 Ford Mustang Mach 1 Fastback";
  mach1Hit.lot_series_meta = "428 CI Cobra Jet V-8, 4-Speed";
  mach1Hit.taxonomies.lot_year = [{ name: 1969, slug: "1969" }];
  mach1Hit.taxonomies.make = [{ name: "Ford", slug: "ford" }];
  mach1Hit.taxonomies.model = [{ name: "Mustang", slug: "mustang" }];
  delete mach1Hit.taxonomies.body_type;
  const mach1Res: any = indexLot(mach1Hit);
  if (
    mach1Res.lot.series !== "Mach 1" ||
    mach1Res.lot.trim !== "Mach 1 Cobra Jet" ||
    mach1Res.lot.body_style !== "Fastback"
  ) {
    throw new Error(`unexpected Mach 1 facets: ${JSON.stringify(mach1Res.lot)}`);
  }

  const bossFacets = extractStructuredLotFacets({
    year: 1970,
    make: "Ford",
    model: "Mustang",
    title: "1970 Ford Mustang Boss 302 Fastback",
  });
  if (bossFacets.series !== "Boss 302" || bossFacets.trim !== "Boss 302" || bossFacets.body_style !== "Fastback") {
    throw new Error(`unexpected Boss 302 facets: ${JSON.stringify(bossFacets)}`);
  }
});

Deno.test("extractStructuredLotFacets carries the shared collector-marque taxonomy (300 SL, XK140 DHC, 250 GT SWB, Shelby, Bronco, Squarebody)", () => {
  const cases: Array<[Parameters<typeof extractStructuredLotFacets>[0], [string | null, string | null, string | null]]> = [
    [{ year: 1955, make: "Mercedes-Benz", model: "300 SL", title: "1955 Mercedes-Benz 300 SL Gullwing", taxonomyBodyStyle: "Coupe" }, ["300 SL", "Gullwing", "Gullwing Coupe"]],
    [{ year: 1956, make: "Jaguar", model: "XK140", title: "1956 Jaguar XK140 SE Drophead Coupe" }, ["XK140", "SE", "Convertible"]],
    [{ year: 1961, make: "Ferrari", model: "250 GT", title: "1961 Ferrari 250 GT SWB Berlinetta" }, ["250 GT SWB", "SWB", "Coupe"]],
    [{ year: 1967, make: "Shelby", model: "GT500", title: "1967 Shelby GT500 Fastback" }, ["Shelby GT500", "GT500", "Fastback"]],
    [{ year: 1966, make: "Ford", model: "Bronco", title: "1966 Ford Bronco U13 Roadster" }, ["U13 Roadster", null, "Roadster"]],
    [{ year: 1967, make: "Ford", model: "Bronco", title: "1967 Ford Bronco U14 Half-Cab" }, ["U14 Half-Cab", null, "Half-Cab"]],
    [{ year: 1976, make: "Ford", model: "Bronco", title: "1976 Ford Bronco Ranger", taxonomyBodyStyle: "SUV" }, ["U15 Wagon", "Ranger", "SUV"]],
    [{ year: 1978, make: "Chevrolet", model: "K10", title: "1978 Chevrolet K10 Cheyenne Super Stepside Pickup", taxonomyBodyStyle: "Pickup" }, ["K10", "Cheyenne Super", "Stepside Pickup"]],
  ];
  for (const [input, want] of cases) {
    const f = extractStructuredLotFacets(input);
    const got = [f.series, f.trim, f.body_style];
    if (JSON.stringify(got) !== JSON.stringify(want)) throw new Error(`${input.title}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  }
});

Deno.test("a taxonomy trim and a specific taxonomy body style are kept over extracted ones", () => {
  const f = extractStructuredLotFacets({ year: 1970, make: "Plymouth", model: "Road Runner", title: "1970 Plymouth Road Runner Superbird", taxonomyTrim: "Hemi", taxonomyBodyStyle: "Hardtop" });
  if (f.series !== "Superbird" || f.trim !== "Hemi" || f.body_style !== "Hardtop") throw new Error(JSON.stringify(f));
});

Deno.test("Road Art is not a vehicle", () => {
  const hit = byType("Road Art");
  if (hit && (indexLot(hit) as any).skip !== "not_a_vehicle_type") throw new Error("road art landed");
});

Deno.test("a lot without year and make is skipped, not guessed", () => {
  const hit = structuredClone(FIXTURE.find((h) => h.taxonomies.lot_type?.[0]?.name === "Auto"));
  delete hit.taxonomies.make;
  if ((indexLot(hit) as any).skip !== "no_year_make") throw new Error("expected no_year_make");
});

Deno.test("bid-goes-on keeps the high bid and states no sale", () => {
  const hit = FIXTURE.find((h) => h.bid_goes_on === 1 && h.taxonomies.lot_type?.[0]?.name === "Auto");
  if (!hit) return;
  const r: any = indexLot(hit);
  if (r.lot.result !== "bid-goes-on") throw new Error(JSON.stringify(r.lot));
});

Deno.test("a sale facet names its key and dates", () => {
  const s = parseSaleFacet("Kissimmee 2027|1799107200|1800144000", "kissimmee-2027");
  if (s?.sale_starts_on !== "2027-01-05" || s?.sale_ends_on !== "2027-01-17") throw new Error(JSON.stringify(s));
});

import { priorSaleFacet, seriesKey, summarizePriorSale } from "./indexLot.ts";

Deno.test("a renamed series is one series", () => {
  if (seriesKey("Dallas 2024") !== seriesKey("Dallas/Fort Worth 2026")) throw new Error("dallas");
  if (seriesKey("Las Vegas Motorcycles 2026") !== seriesKey("LV Motorcycles 2027")) throw new Error("motorcycles");
  if (seriesKey("Las Vegas 2025") === seriesKey("Las Vegas Motorcycles 2026")) throw new Error("las vegas must not match its motorcycle sale");
});

Deno.test("the prior sale is the latest earlier sale of the series", () => {
  const all = ["Dallas 2024|1725408000|1725667200", "Dallas/Fort Worth 2025|1761696000|1761955200", "Dallas/Fort Worth 2026|1792540800|1792800000", "Kissimmee 2025|1736208000|1737244800"];
  const p = priorSaleFacet("Dallas/Fort Worth 2026|1792540800|1792800000", all);
  if (p !== "Dallas/Fort Worth 2025|1761696000|1761955200") throw new Error(String(p));
  if (priorSaleFacet("Tulsa 2026|1780617600|1780704000", all) !== null) throw new Error("no prior expected");
});

Deno.test("a prior sale summary counts vehicle lots, sold, bid-goes-on and the median of priced sold lots", () => {
  const lot = (type: string, sold: number, bgo: number, price: number) => ({ taxonomies: { lot_type: [{ name: type }] }, sold, bid_goes_on: bgo, highest_bid_or_price: price });
  const s = summarizePriorSale([lot("Auto", 1, 0, 10000), lot("Auto", 1, 0, 30000), lot("Auto", 1, 0, 20000), lot("Motorcycle", 0, 1, 5000), lot("Road Art", 1, 0, 400)], "dallas-fort-worth-2025", "2025-10-29");
  if (s.lots !== 5 || s.vehicle_lots !== 4 || s.sold !== 3 || s.bid_goes_on !== 1 || s.median_price !== 20000 || s.priced !== 3) throw new Error(JSON.stringify(s));
});
