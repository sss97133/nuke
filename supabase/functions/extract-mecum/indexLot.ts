/**
 * Pure readers for Mecum's public lot index (Algolia wp_posts_lot): the sale named by an auction_tax facet value, and one
 * index record as a lot with the sale facts it states. No request and no write here.
 */

export const saleDay = (epochSeconds: number) => new Date(epochSeconds * 1000).toISOString().slice(0, 10);

/** The sale a facet value "Name|startEpoch|endEpoch" names. The slug comes from the hit's auction_tax term. */
export function parseSaleFacet(value: string, slug: string): { sale_key: string; auction_name: string; sale_starts_on: string; sale_ends_on: string; end_epoch: number } | null {
  const [name, start, end] = value.split("|");
  const startEpoch = Number(start), endEpoch = Number(end);
  if (!name || !slug || !Number.isFinite(startEpoch) || !Number.isFinite(endEpoch)) return null;
  return { sale_key: slug, auction_name: name, sale_starts_on: saleDay(startEpoch), sale_ends_on: saleDay(endEpoch), end_epoch: endEpoch };
}


// ─── Index-sourced thin landing ─────────────────────────────────────────

/** One lot of Mecum's public search index (Algolia wp_posts_lot), reduced to the sale facts it states. */
export interface IndexLot {
  url: string;
  lot_id: string;
  object_id: string | null;
  title: string | null;
  year: number;
  make: string;
  model: string | null;
  series: string | null;
  trim: string | null;
  body_style: string | null;
  result: "sold" | "bid-goes-on" | null;
  price: number | null; // the hammer on a sold lot, the high bid otherwise; null when the index states none
  estimate_low: number | null;
  estimate_high: number | null;
  run_day: string | null;
  day_start: string | null;
  lot_number: string | null;
  sale_key: string | null;
  sale_name: string | null;
  sale_starts_on: string | null;
  sale_ends_on: string | null;
  lot_statuses: string[];
  image_urls: string[];
  exterior_color: string | null;
  interior_color: string | null;
  transmission: string | null;
  engine: string | null;
  engine_configuration: string | null;
  collection_name: string | null;
  description: string | null;
}

export const INDEX_VEHICLE_TYPES = new Set(["Auto", "Motorcycle", "Tractor", "Boat"]);

/**
 * Extracts structured `series`, `trim`, and `body_style` facets from a Mecum lot's
 * make, model, title, and highlights/description text when the taxonomy leaves them blank or coarse.
 */
export function extractStructuredLotFacets(params: {
  year?: number | null;
  make?: string | null;
  model?: string | null;
  title?: string | null;
  highlights?: string | null;
  taxonomyTrim?: string | null;
  taxonomyBodyStyle?: string | null;
}): { series: string | null; trim: string | null; body_style: string | null } {
  const brand = (params.make ?? "").trim().toLowerCase();
  const modelRaw = (params.model ?? "").trim();
  const haystack = [params.title, modelRaw, params.highlights].filter(Boolean).join(" ").toUpperCase();

  let series: string | null = null;
  let trim: string | null = params.taxonomyTrim?.trim() || null;
  let bodyStyle: string | null = params.taxonomyBodyStyle?.trim() || null;

  // ── 1. SERIES EXTRACTION ───────────────────────────────────────────────────
  if (brand === "chevrolet" || brand === "gmc" || /\b(PICKUP|TRUCK|SUBURBAN|BLAZER|JIMMY)\b/.test(haystack)) {
    if (/\bC[-\s]?10\b/.test(haystack)) series = "C10";
    else if (/\bK[-\s]?10\b/.test(haystack)) series = "K10";
    else if (/\bC[-\s]?20\b/.test(haystack)) series = "C20";
    else if (/\bK[-\s]?20\b/.test(haystack)) series = "K20";
    else if (/\bC[-\s]?30\b/.test(haystack)) series = "C30";
    else if (/\bK[-\s]?30\b/.test(haystack)) series = "K30";
    else if (/\bR[-\s]?10\b/.test(haystack)) series = "R10";
    else if (/\bV[-\s]?10\b/.test(haystack)) series = "V10";
    else if (/\b3100\b/.test(haystack)) series = "3100";
    else if (/\b3600\b/.test(haystack)) series = "3600";
    else if (/\b3800\b/.test(haystack)) series = "3800";
    else if (/\bAPACHE\b/.test(haystack)) series = "Apache";
    else if (/\bCAMEO\b/.test(haystack)) series = "Cameo Carrier";
    else if (/\bK[-\s]?1500\b/.test(haystack)) series = "K1500";
    else if (/\bC[-\s]?1500\b/.test(haystack)) series = "C1500";
    else if (/\bK[-\s]?2500\b/.test(haystack)) series = "K2500";
    else if (/\bC[-\s]?2500\b/.test(haystack)) series = "C2500";
    else if (/\b1500\b/.test(haystack) && (brand === "chevrolet" || brand === "gmc")) series = "1500";
    else if (/\b2500\b/.test(haystack) && (brand === "chevrolet" || brand === "gmc")) series = "2500";
    else if (/\b3500\b/.test(haystack) && (brand === "chevrolet" || brand === "gmc")) series = "3500";
  }

  if (!series && brand === "ford") {
    if (/\bF[-\s]?100\b/.test(haystack)) series = "F-100";
    else if (/\bF[-\s]?150\b/.test(haystack)) series = "F-150";
    else if (/\bF[-\s]?250\b/.test(haystack)) series = "F-250";
    else if (/\bF[-\s]?350\b/.test(haystack)) series = "F-350";
    else if (/\bF[-\s]?1\b/.test(haystack)) series = "F-1";
    else if (/\bSHELBY\s+GT500KR\b/.test(haystack)) series = "Shelby GT500KR";
    else if (/\bSHELBY\s+GT500\b|\bGT500\b/.test(haystack)) series = "Shelby GT500";
    else if (/\bSHELBY\s+GT350R\b|\bGT350R\b/.test(haystack)) series = "Shelby GT350R";
    else if (/\bSHELBY\s+GT350\b|\bGT350\b/.test(haystack)) series = "Shelby GT350";
    else if (/\bBOSS\s+429\b/.test(haystack)) series = "Boss 429";
    else if (/\bBOSS\s+302\b/.test(haystack)) series = "Boss 302";
    else if (/\bBOSS\s+351\b/.test(haystack)) series = "Boss 351";
    else if (/\bMACH\s+1\b/.test(haystack)) series = "Mach 1";
    else if (/\bU13\b/.test(haystack)) series = "U13 Roadster";
    else if (/\bU14\b/.test(haystack)) series = "U14 Half-Cab";
    else if (/\bU15\b/.test(haystack)) series = "U15 Wagon";
  }

  if (!series && (brand === "dodge" || brand === "plymouth")) {
    if (/\bSUPERBIRD\b/.test(haystack)) series = "Superbird";
    else if (/\bCHARGER\s+DAYTONA\b/.test(haystack)) series = "Daytona";
    else if (/\bCHARGER\s+500\b/.test(haystack)) series = "Charger 500";
    else if (/\bAAR\s+['\u2019]?CUDA\b/.test(haystack)) series = "AAR 'Cuda";
    else if (/\bCHALLENGER\s+T\/A\b/.test(haystack)) series = "T/A";
    else if (/\bPOWER\s+WAGON\b/.test(haystack)) series = "Power Wagon";
    else if (/\bD[-\s]?100\b/.test(haystack)) series = "D100";
    else if (/\bD[-\s]?150\b/.test(haystack)) series = "D150";
    else if (/\bW[-\s]?100\b/.test(haystack)) series = "W100";
    else if (/\bW[-\s]?150\b/.test(haystack)) series = "W150";
  }

  if (!series && brand === "porsche") {
    if (/\bGT3\s+RS\b/.test(haystack)) series = "GT3 RS";
    else if (/\bGT3\b/.test(haystack)) series = "GT3";
    else if (/\bGT2\s+RS\b/.test(haystack)) series = "GT2 RS";
    else if (/\bCARRERA\s+RS\b/.test(haystack)) series = "Carrera RS";
    else if (/\bCARRERA\s+4S\b|\bC4S\b/.test(haystack)) series = "Carrera 4S";
    else if (/\bCARRERA\s+S\b/.test(haystack)) series = "Carrera S";
    else if (/\bCARRERA\b/.test(haystack)) series = "Carrera";
  }

  // ── 2. TRIM PACKAGE EXTRACTION ─────────────────────────────────────────────
  if (!trim) {
    if (/\bCHEYENNE\s+SUPER\b/.test(haystack)) trim = "Cheyenne Super";
    else if (/\bCHEYENNE\b/.test(haystack)) trim = "Cheyenne";
    else if (/\bSCOTTSDALE\b/.test(haystack)) trim = "Scottsdale";
    else if (/\bCUSTOM\s+DELUXE\b/.test(haystack)) trim = "Custom Deluxe";
    else if (/\bSILVERADO\b/.test(haystack) && modelRaw.toUpperCase() !== "SILVERADO") trim = "Silverado";
    else if (/\bBIG\s+10\b/.test(haystack)) trim = "Big 10";
    else if (/\b454\s+SS\b/.test(haystack)) trim = "454 SS";
    else if (/\bCST\b|\bCUSTOM\s+SPORT\s+TRUCK\b/.test(haystack)) trim = "CST";
    else if (/\bSIERRA\s+CLASSIC\b/.test(haystack)) trim = "Sierra Classic";
    else if (/\bSIERRA\s+GRANDE\b/.test(haystack)) trim = "Sierra Grande";
    else if (/\bHIGH\s+SIERRA\b/.test(haystack)) trim = "High Sierra";
    else if (/\bGENTLEMAN\s+JIM\b/.test(haystack)) trim = "Gentleman Jim";
    else if (/\bRANGER\s+XLT\b/.test(haystack)) trim = "Ranger XLT";
    else if (/\bRANGER\s+LARIAT\b|\bLARIAT\b/.test(haystack)) trim = "Lariat";
    else if (/\bXLT\b/.test(haystack)) trim = "XLT";
    else if (/\bEDDIE\s+BAUER\b/.test(haystack)) trim = "Eddie Bauer";
    else if (/\bBOSS\s+429\b/.test(haystack)) trim = "Boss 429";
    else if (/\bBOSS\s+302\b/.test(haystack)) trim = "Boss 302";
    else if (/\bMACH\s+1\b/.test(haystack)) trim = "Mach 1";
    else if (/\bZ\/?28\b/.test(haystack)) trim = "Z/28";
    else if (/\bIROC[-\s]?Z\b/.test(haystack)) trim = "IROC-Z";
    else if (/\bRS\/SS\b|\bSS\/RS\b/.test(haystack)) trim = "RS/SS";
    else if (/\bSS\s*454\b/.test(haystack)) trim = "SS 454";
    else if (/\bSS\s*396\b/.test(haystack)) trim = "SS 396";
    else if (/\bSUPER\s+SPORT\b|\bSS\b/.test(haystack)) trim = "SS";
    else if (/\bZ06\b/.test(haystack)) trim = "Z06";
    else if (/\bZR[-\s]?1\b/.test(haystack)) trim = "ZR1";
    else if (/\bR\/T\b/.test(haystack)) trim = "R/T";
    else if (/\b426\s+HEMI\b|\bHEMI\b/.test(haystack)) trim = "Hemi";
  }

  // ── 3. BODY STYLE REFINEMENT / EXTRACTION ──────────────────────────────────
  // Refine generic "Pickup" or missing body_style when the title or highlights specify Stepside/Fleetside/Fastback/etc.
  const isGenericPickup = !bodyStyle || /^pickup$/i.test(bodyStyle);
  if (isGenericPickup && /\b(STEPSIDE|FLARESIDE|FENDERSIDE)\b/.test(haystack)) {
    bodyStyle = /\bFLARESIDE\b/.test(haystack) ? "Flareside Pickup" : "Stepside Pickup";
  } else if (isGenericPickup && /\b(FLEETSIDE|STYLESIDE|SWEPTLINE|WIDELINE)\b/.test(haystack)) {
    bodyStyle = /\bSTYLESIDE\b/.test(haystack) ? "Styleside Pickup" : "Fleetside Pickup";
  } else if (!bodyStyle) {
    if (/\bSPLIT[-\s]?WINDOW\b/.test(haystack)) bodyStyle = "Split-Window Coupe";
    else if (/\bFASTBACK\b|\bSPORTSROOF\b/.test(haystack)) bodyStyle = "Fastback";
    else if (/\bCONVERTIBLE\b|\bCABRIOLET\b/.test(haystack)) bodyStyle = "Convertible";
    else if (/\bROADSTER\b|\bSPEEDSTER\b|\bSPYDER\b|\bSPIDER\b/.test(haystack)) bodyStyle = "Roadster";
    else if (/\bTARGA\b/.test(haystack)) bodyStyle = "Targa";
    else if (/\bHARDTOP\b/.test(haystack)) bodyStyle = "Hardtop";
    else if (/\bCOUPE\b/.test(haystack)) bodyStyle = "Coupe";
    else if (/\bSEDAN\b/.test(haystack)) bodyStyle = "Sedan";
    else if (/\bWAGON\b|\bNOMAD\b|\bSUBURBAN\b/.test(haystack)) bodyStyle = "Wagon";
    else if (/\bSUV\b|\bBLAZER\b|\bBRONCO\b|\bJIMMY\b|\bCOMMANDO\b/.test(haystack)) bodyStyle = "SUV";
    else if (/\bPICKUP\b|\bTRUCK\b/.test(haystack)) bodyStyle = "Pickup";
  }

  return { series, trim, body_style: bodyStyle };
}

/** First taxonomy term's name (or its slug) from an index record, tolerant of a missing or odd shape. */
export function termName(t: any, key: string, field: "name" | "slug" = "name"): string | null {
  const v = t?.[key];
  const x = Array.isArray(v) ? v[0] : null;
  const out = x && typeof x === "object" ? x[field] : x;
  return out === undefined || out === null || out === "" ? null : String(out);
}

/** An index record as an IndexLot, or the reason it is not one. Pure: no request, no write. */
export function indexLot(hit: any): { lot: IndexLot } | { skip: string; url?: string; title?: string } {
  const t = hit?.taxonomies;
  if (!t || typeof t !== "object") return { skip: "no_taxonomies" };
  const lotType = termName(t, "lot_type");
  if (!lotType || !INDEX_VEHICLE_TYPES.has(lotType)) return { skip: "not_a_vehicle_type" };
  const permalink = typeof hit.permalink === "string" ? hit.permalink : "";
  const lotId = permalink.match(/\/lots\/([A-Za-z0-9-]+)\//)?.[1];
  if (!lotId) return { skip: "no_lot_id" };
  const year = Number(termName(t, "lot_year"));
  const make = termName(t, "make");
  if (!Number.isInteger(year) || year < 1885 || year > 2100 || !make) return { skip: "no_year_make", url: `https://www.mecum.com${permalink}`, title: typeof hit.post_title === "string" ? hit.post_title : undefined };
  const resultName = termName(t, "sale_result", "slug");
  const result = hit.sold === 1 || resultName === "sold" ? "sold" : (hit.bid_goes_on === 1 || resultName === "bid-goes-on" ? "bid-goes-on" : null);
  const rawPrice = Number(hit.highest_bid_or_price) || Number(hit.hammer_price_meta);
  const price = Number.isFinite(rawPrice) && rawPrice > 0 ? Math.round(rawPrice) : null;
  const rawEstLow = Number(hit.low_estimate_meta);
  const estimateLow = Number.isFinite(rawEstLow) && rawEstLow > 0 ? Math.round(rawEstLow) : null;
  const rawEstHigh = Number(hit.high_estimate_meta);
  const estimateHigh = Number.isFinite(rawEstHigh) && rawEstHigh > 0 ? Math.round(rawEstHigh) : null;
  const sale = Array.isArray(t.auction_tax) ? t.auction_tax[0] : null;
  const parsed = sale?.name && sale?.slug ? parseSaleFacet(String(sale.name), String(sale.slug)) : null;
  const runDayRaw = termName(t, "run_date") || termName(t, "run_date", "slug");
  const parsedRunDay = runDayRaw && /^\d{4}-\d{2}-\d{2}/.test(runDayRaw)
    ? runDayRaw.slice(0, 10)
    : (typeof hit.auction_end_date_meta === "number" && hit.auction_end_date_meta > 100000000
      ? saleDay(hit.auction_end_date_meta)
      : null);
  const dayStart = typeof hit.auction_day_start_meta === "string" ? hit.auction_day_start_meta : null;
  const title = typeof hit.post_title === "string" && hit.post_title.trim() ? hit.post_title.trim() : null;
  const lotNumber = typeof hit.lot_number_meta === "string" && hit.lot_number_meta ? hit.lot_number_meta : null;
  const model = termName(t, "model");
  const taxonomyBodyStyle = termName(t, "body_type");
  const taxonomyTrim = termName(t, "trim_sub_model");
  const imageUrls = Array.isArray(hit.images_meta)
    ? hit.images_meta.map((img: any) => (typeof img?.url === "string" ? img.url.trim() : "")).filter((u: string) => u.startsWith("http"))
    : [];
  const exteriorColor = typeof hit.color_meta === "string" && hit.color_meta.trim() ? hit.color_meta.trim() : null;
  const interiorColor = typeof hit.interior_meta === "string" && hit.interior_meta.trim() ? hit.interior_meta.trim() : null;
  const transmission = typeof hit.transmission_type_meta === "string" && hit.transmission_type_meta.trim() ? hit.transmission_type_meta.trim() : null;
  const engineConfig = typeof hit.engine_configuration_meta === "string" && hit.engine_configuration_meta.trim() ? hit.engine_configuration_meta.trim() : null;
  const engine = typeof hit.lot_series_meta === "string" && hit.lot_series_meta.trim()
    ? hit.lot_series_meta.trim()
    : engineConfig;
  const structuredFacets = extractStructuredLotFacets({
    year,
    make,
    model,
    title,
    highlights: engine,
    taxonomyTrim,
    taxonomyBodyStyle,
  });
  const collectionRaw = termName(t, "collection_tax");
  const collectionName = collectionRaw ? collectionRaw.split("|")[0].replace(/&amp;/g, "&").trim() || null : null;
  const descParts = [
    title,
    engine ? `Highlights: ${engine}.` : null,
    parsed?.auction_name ? `Offered at Mecum ${parsed.auction_name}${lotNumber ? ` (Lot ${lotNumber})` : ""}.` : null,
    collectionName ? `Collection: ${collectionName}.` : null,
  ].filter(Boolean);
  const description = descParts.length > 1 ? descParts.join(" ") : null;

  return {
    lot: {
      url: `https://www.mecum.com${permalink}`,
      lot_id: lotId,
      object_id: hit.objectID ?? null,
      title,
      year,
      make,
      model,
      series: structuredFacets.series,
      trim: structuredFacets.trim,
      body_style: structuredFacets.body_style,
      result,
      price: result ? price : null,
      estimate_low: estimateLow,
      estimate_high: estimateHigh,
      run_day: parsedRunDay,
      day_start: dayStart && !isNaN(Date.parse(dayStart.replace(" ", "T") + "Z")) ? new Date(dayStart.replace(" ", "T") + "Z").toISOString() : null,
      lot_number: lotNumber,
      sale_key: parsed?.sale_key ?? null,
      sale_name: parsed?.auction_name ?? null,
      sale_starts_on: parsed?.sale_starts_on ?? null,
      sale_ends_on: parsed?.sale_ends_on ?? null,
      lot_statuses: (Array.isArray(t.lot_status) ? t.lot_status : []).map((x: any) => x?.slug).filter(Boolean),
      image_urls: imageUrls,
      exterior_color: exteriorColor,
      interior_color: interiorColor,
      transmission,
      engine,
      engine_configuration: engineConfig,
      collection_name: collectionName,
      description,
    },
  };
}


// ─── Prior sale of a series ─────────────────────────────────────────────

/**
 * A sale's series, so a renamed series still matches its past sales: "Dallas 2024" and "Dallas/Fort Worth 2026" are one series,
 * and so are "Las Vegas Motorcycles 2026" and "LV Motorcycles 2027". The year is dropped and the name is reduced to letters.
 */
export function seriesKey(saleName: string): string {
  return saleName.toLowerCase()
    .replace(/\s+\d{4}$/, "")
    .replace(/\/?\s*fort worth/, "")
    .replace(/^lv\b/, "las vegas")
    .replace(/[^a-z0-9]/g, "");
}

/** The sale facet values ("Name|startEpoch|endEpoch") of the same series that ended before this one started: the latest first. */
export function priorSaleFacet(upcoming: string, all: string[]): string | null {
  const [name, start] = upcoming.split("|");
  const startEpoch = Number(start);
  if (!name || !Number.isFinite(startEpoch)) return null;
  const key = seriesKey(name);
  let best: { value: string; end: number } | null = null;
  for (const value of all) {
    const [n, , e] = value.split("|");
    const end = Number(e);
    if (!n || !Number.isFinite(end) || end >= startEpoch || seriesKey(n) !== key) continue;
    if (!best || end > best.end) best = { value, end };
  }
  return best?.value ?? null;
}

export interface PriorSale {
  sale_key: string | null;
  lots: number;
  vehicle_lots: number;
  sold: number;
  bid_goes_on: number;
  median_price: number | null;
  priced: number;
  ends_on: string;
}

/** Vehicle lots are every lot that is not Road Art. Sold and bid-goes-on count vehicle lots; the median is of sold lots with a stated price. */
export function summarizePriorSale(hits: any[], saleKey: string | null, endsOn: string): PriorSale {
  const vehicle = hits.filter((h) => termName(h?.taxonomies, "lot_type") !== "Road Art");
  const sold = vehicle.filter((h) => h?.sold === 1);
  const prices = sold.map((h) => Number(h?.highest_bid_or_price) || Number(h?.hammer_price_meta)).filter((p) => Number.isFinite(p) && p > 0).sort((a, b) => a - b);
  const mid = prices.length >> 1;
  const median = prices.length === 0 ? null : (prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2);
  return {
    sale_key: saleKey,
    lots: hits.length,
    vehicle_lots: vehicle.length,
    sold: sold.length,
    bid_goes_on: vehicle.filter((h) => h?.bid_goes_on === 1).length,
    median_price: median,
    priced: prices.length,
    ends_on: endsOn,
  };
}
