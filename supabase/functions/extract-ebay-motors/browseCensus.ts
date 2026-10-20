/**
 * eBay census: how many cars eBay itself says are listed, read from the Browse API once a day.
 * One source_census row per run (the table every source's population reading lives in):
 *   universe_active / by_category['6001']  Browse's own total for category 6001 (Cars & Trucks), no keywords. A snapshot of what is
 *                                          listed now, not eBay's history.
 *   by_make, by_year                       eBay's refinement counts (Make, Model Year).
 *   by_category.vintage_le_1991            listings whose Model Year is 1991 or older (tiers 1 and 2 in browseMap.tierOfYear).
 *   raw_response.vintage_by_zip3           those vintage listings tallied by the 3-digit ZIP prefix eBay gives on every item
 *                                          (itemLocation.postalCode, e.g. '891**'): the area counts, for pickup and shipped listings alike.
 *   raw_response.local_pickup              eBay's own near-me count per anchor ZIP: local-pickup listings within 100 miles, plus how many
 *                                          are vintage. Only listings that offer local pickup are in it.
 * Cost: about 40 Browse calls; the vintage walk is skipped when fewer than 1,000 of the day's 5,000 remain.
 */
import { aspectFilterFor, type BrowseClient, yearAspect } from "./browseApi.ts";

export const VINTAGE_MAX_YEAR = 1991;
export const PICKUP_RADIUS_MI = 100;
/** Anchor ZIPs for the near-me counts: Las Vegas first (the owner's), then the large US car markets. */
export const ANCHORS: Array<[string, string]> = [
  ["89101", "Las Vegas"], ["90001", "Los Angeles"], ["92101", "San Diego"], ["94103", "San Francisco"], ["85001", "Phoenix"],
  ["77002", "Houston"], ["75201", "Dallas"], ["78205", "San Antonio"], ["60601", "Chicago"], ["10001", "New York"],
  ["19103", "Philadelphia"], ["33101", "Miami"],
];

export const pickupFilter = (zip: string) =>
  `deliveryOptions:{SELLER_ARRANGED_LOCAL_PICKUP},pickupCountry:US,pickupPostalCode:${zip},pickupRadius:${PICKUP_RADIUS_MI},pickupRadiusUnit:mi`;

/** '891**' -> '891'; anything that is not three digits first -> null. */
export function zip3Of(postalCode: unknown): string | null {
  const m = /^(\d{3})/.exec(String(postalCode ?? ""));
  return m ? m[1] : null;
}

export function tallyZip3(items: any[], into: Record<string, number>): void {
  for (const it of items) {
    const z = zip3Of(it?.itemLocation?.postalCode) ?? "none";
    into[z] = (into[z] ?? 0) + 1;
  }
}

const countsOf = (dist: any[], name: string): Record<string, number> => {
  const d = dist.find((x) => String(x.localizedAspectName ?? "").trim().toLowerCase() === name);
  const out: Record<string, number> = {};
  for (const v of d?.aspectValueDistributions ?? []) out[String(v.localizedAspectValue)] = Number(v.matchCount ?? 0);
  return out;
};

export interface CensusReading {
  as_of: string; total: number; makes: Record<string, number>; years: Record<string, number>;
  vintage: { total: number; read: number; by_zip3: Record<string, number>; skipped: string | null };
  local_pickup: Record<string, { label: string; radius_mi: number; total: number; vintage: number }>;
  calls: number;
}

export async function readCensus(client: BrowseClient, now = new Date()): Promise<CensusReading> {
  const dist = await client.aspectRefinements();
  const ya = yearAspect(dist);
  const page = await client.search({ limit: 1, fieldgroups: "ASPECT_REFINEMENTS" });
  const out: CensusReading = {
    as_of: now.toISOString(), total: page.total, makes: countsOf(dist, "make"),
    years: ya ? Object.fromEntries([...ya.counts].sort((a, b) => a[0] - b[0]).map(([y, n]) => [String(y), n])) : {},
    vintage: { total: 0, read: 0, by_zip3: {}, skipped: null }, local_pickup: {}, calls: 0,
  };

  // near-me counts: total, and vintage among them, per anchor ZIP
  for (const [zip, label] of ANCHORS) {
    const all = await client.search({ limit: 1, filter: pickupFilter(zip) });
    let vintage = 0;
    if (ya) {
      const yrs = [...ya.counts].filter(([y, n]) => y <= VINTAGE_MAX_YEAR && n > 0).map(([y]) => y);
      for (let i = 0; i < yrs.length; i += 25) {
        const v = await client.search({ limit: 1, filter: pickupFilter(zip), aspectFilter: aspectFilterFor(ya.name, yrs.slice(i, i + 25)) });
        vintage += v.total;
      }
    }
    out.local_pickup[zip] = { label, radius_mi: PICKUP_RADIUS_MI, total: all.total, vintage };
  }

  // every vintage listing, tallied by ZIP prefix
  const quota = await client.remainingToday();
  if (!ya) out.vintage.skipped = "no Model Year aspect";
  else if (quota && quota.remaining < 1000) out.vintage.skipped = `only ${quota.remaining} Browse calls left today`;
  else {
    const yrs = [...ya.counts].filter(([y, n]) => y <= VINTAGE_MAX_YEAR && n > 0).map(([y]) => y);
    for (let i = 0; i < yrs.length; i += 25) {
      const filter = aspectFilterFor(ya.name, yrs.slice(i, i + 25));
      let offset = 0;
      for (;;) {
        const res = await client.search({ aspectFilter: filter, offset, limit: 200 });
        if (offset === 0) out.vintage.total += res.total;
        tallyZip3(res.itemSummaries, out.vintage.by_zip3);
        out.vintage.read += res.itemSummaries.length;
        offset += 200;
        if (!res.itemSummaries.length || offset >= res.total || offset >= 10_000) break;
      }
    }
  }
  out.calls = client.calls;
  return out;
}

/** The source_census row for a reading. */
export function censusRow(sourceId: string, r: CensusReading) {
  return {
    source_id: sourceId, universe_total: r.total, universe_active: r.total,
    census_method: "ebay_browse_category_total", census_confidence: 0.9, census_at: r.as_of,
    census_url: "https://api.ebay.com/buy/browse/v1/item_summary/search?category_ids=6001",
    census_notes: `eBay Browse API, category 6001 (Cars & Trucks), no keywords, ${r.as_of}: listings open now. vintage_le_1991 is Model Year 1991 or older; ${r.vintage.read} of ${r.vintage.total} were read and tallied by ZIP prefix (raw_response.vintage_by_zip3)${r.vintage.skipped ? `; vintage walk skipped: ${r.vintage.skipped}` : ""}. raw_response.local_pickup counts only listings that offer local pickup within ${PICKUP_RADIUS_MI} miles of each anchor ZIP.`,
    by_make: r.makes, by_year: r.years, by_category: { "6001": r.total, vintage_le_1991: r.vintage.total },
    raw_response: { vintage_by_zip3: r.vintage.by_zip3, vintage_read: r.vintage.read, vintage_skipped: r.vintage.skipped, local_pickup: r.local_pickup, calls: r.calls },
  };
}
