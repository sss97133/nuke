/**
 * The eBay Motors intake that needs no eBay developer account: Firecrawl reads eBay's public search and item pages.
 *
 *   discover  per tier (years) and per eBay "For Sale By" facet, newest first:
 *               1 credit: one search page of 240 cards (retain.ts keeps the Firecrawl response in the listing-snapshots bucket, pointed at by a listing_page_snapshots row)
 *               every card not seen before lands as a blip (unresolved listing observation: title, price, format, year, miles,
 *               brand, seller, feedback, listed label), through writeObservation -> ingest-observation
 *               then the item pages of the not-yet-read cards, private sellers first, tier 1 before tier 2, 1 credit each,
 *               landed as a vehicle (ingest), an observation and a listing episode (browseSweep.landItem), under a per-run
 *               and a per-day cap.
 *   Private/dealer: the facet and the item specific "For Sale By" are eBay's own seller-declared attribute; the class stored
 *   with the listing is a Nuke claim that cites it (browseMap.classifySeller).
 */
import { firecrawlFetcher, type PageFetcher } from "./retain.ts";
import { writeObservation } from "../_shared/observationWriter.ts";
import { TIERS, tierOfYear } from "./browseMap.ts";
import { emptyReport, heldKeys, landItem, pool, PLATFORM, type Report } from "./browseSweep.ts";
import { type Card, type Facet, pageToItem, parseItemPage, parseSearchCards, resultCount, searchUrl } from "./ebayPage.ts";

export interface DiscoverOptions {
  tiers?: number[];                 // default [1, 2]
  facets?: Facet[];                 // default ["private"]; "unspecified" is read only when asked
  jobs?: { tiers: number[]; facets: Facet[] }[]; // several (tiers x facets) groups in one run; replaces tiers/facets
  pages?: number;                   // search pages per tier and facet per run (default 1)
  deepMax?: number;                 // item pages per run (default 15)
  dailyItemCap?: number;            // item pages per UTC day across runs (default 60)
  dryRun?: boolean;                 // read search pages, write nothing, read no item pages
  backfill?: boolean;               // read every requested page to the end (no stop at known cards); item pages are the caller's to read
  fetchPage?: PageFetcher;          // test seam
}

export interface DiscoverReport extends Report {
  search_pages: number; cards: number; blips_new: number; blips_duplicate: number; deep_read: number; deep_cap_left: number | null;
  facet_totals: Record<string, number | null>;
}

const SOURCE = "ebay-firecrawl";
const METHOD = "ebay_firecrawl_v1";

const cardFields = (c: Card) => {
  const f: Record<string, unknown> = {};
  if (c.year) f.year = c.year;
  if (c.brand) f.make = c.brand;
  if (c.miles) f.mileage = c.miles;
  return f;
};

/** A card is a blip: the listing as the search page states it, with no vehicle behind it yet. */
export async function landBlip(supabase: any, c: Card, facet: Facet, snapshotId: string | null, now: string, tier: number, rep: Report) {
  const r = await writeObservation(supabase, {
    vehicleId: null, unresolved: true,
    source: { platform: PLATFORM, url: c.url, sourceIdentifier: c.itemId },
    fields: cardFields(c), observationKind: "listing", extractionMethod: METHOD, observedAt: now,
    contentText: [c.title, c.subtitle].filter(Boolean).join(" | "),
    rawData: {
      snapshot_id: snapshotId, tier, card: { ...c, rows: undefined }, card_rows: c.rows,
      for_sale_by_filter: { facet, basis: "eBay 'For Sale By' facet applied to the search (seller-declared item specific)" },
      listed_label: c.listedLabel, listed_label_note: "site time, no year, zone unstated",
    },
  } as any);
  if (r.errors?.length) rep.errors.push(`blip ${c.itemId}: ${r.errors.slice(0, 2).join("; ")}`);
  return r;
}

async function itemsReadToday(supabase: any): Promise<number> {
  const since = new Date(); since.setUTCHours(0, 0, 0, 0);
  const r = await supabase.from("listing_page_snapshots").select("id", { count: "exact", head: true })
    .eq("platform", PLATFORM).eq("fetch_method", "firecrawl").like("listing_url", "%/itm/%").gte("fetched_at", since.toISOString())
    .or("metadata->>via.is.null,metadata->>via.neq.deep");   // the cap is discovery's; one-off 'deep' reads (the backfill) are budgeted by their runner
  if (r.error) throw new Error(`daily cap read failed: ${r.error.message}`);
  return r.count ?? 0;
}

export async function discover(supabase: any, o: DiscoverOptions = {}): Promise<DiscoverReport> {
  const fetchPage = o.fetchPage ?? firecrawlFetcher(supabase, PLATFORM);
  const base = emptyReport(o.dryRun ? "discover_dry_run" : "discover");
  const rep: DiscoverReport = { ...base, search_pages: 0, cards: 0, blips_new: 0, blips_duplicate: 0, deep_read: 0, deep_cap_left: null, facet_totals: {} };
  const groups = (o.jobs ?? [{ tiers: o.tiers ?? [1, 2], facets: o.facets ?? ["private"] }])
    .flatMap((j) => TIERS.filter((t) => j.tiers.includes(t.id)).flatMap((tier) => j.facets.map((facet) => ({ tier, facet }))));
  if (groups.some((g) => g.facet === "unspecified")) {
    // Measured 2026-10-15: the Not%2520Specified value is not honoured by eBay (4,100+ results, the unfiltered stream), so it would read dealers.
    rep.ok = false; rep.errors.push("facet 'unspecified' is not a working eBay filter (returns the unfiltered stream); not read");
    return rep;
  }
  const now = new Date().toISOString();
  type Cand = { card: Card; tier: number; facet: Facet };
  const cands: Cand[] = [];

  try {
    {
      for (const { tier, facet } of groups) {
        const t = (rep.per_tier[`${tier.id}:${facet}`] = { seen: 0, held: 0, new: 0, fetched: 0, landed: 0 });
        for (let page = 1; page <= (o.pages ?? 1); page++) {
          const res = await fetchPage(searchUrl(tier.years, facet, page), { markdown: false, metadata: { kind: "search", tier: tier.id, facet, page } });
          rep.search_pages++; rep.calls++;
          if (!res.html || res.error) { rep.errors.push(`search ${tier.id}:${facet} p${page}: ${res.error ?? "empty page"} (HTTP ${res.statusCode ?? "?"})`); break; }
          const cards = parseSearchCards(res.html);
          if (page === 1) rep.facet_totals[`${tier.id}:${facet}`] = resultCount(res.html);
          if (cards.length === 0) { rep.errors.push(`search ${tier.id}:${facet} p${page}: page parsed to 0 cards (snapshot ${res.snapshotId}); layout change or block`); break; }
          t.seen += cards.length; rep.cards += cards.length;
          if (o.dryRun) { for (const c of cards) cands.push({ card: c, tier: tier.id, facet }); continue; }

          // blips: stop paging when a long run of cards is already known (the rest of the page is older)
          let dupRun = 0, stopped = false;
          for (let i = 0; i < cards.length && !stopped; i += 8) {
            const chunk = cards.slice(i, i + 8);
            const results = await Promise.all(chunk.map((c) => landBlip(supabase, c, facet, res.snapshotId, now, tier.id, rep)));
            results.forEach((r, k) => {
              cands.push({ card: chunk[k], tier: tier.id, facet });
              if (r.duplicate) { rep.blips_duplicate++; dupRun++; } else { rep.blips_new++; t.new++; dupRun = 0; }
            });
            if (dupRun >= 24 && !o.backfill) stopped = true;
          }
          if (stopped) break;
        }
      }
    }
    if (o.dryRun) { rep.stopped = "dry run"; return finish(rep); }

    // item pages: not read before, private first, tier 1 before tier 2, newest first (search order)
    if (o.backfill) { rep.stopped = "backfill: search pages and blips only"; return finish(rep); }
    const read = await heldKeys(supabase, cands.map((c) => c.card.itemId));
    const rank = (c: Cand) => c.tier * 10 + (c.facet === "private" ? 0 : c.facet === "unspecified" ? 1 : 2);
    const todo = cands.filter((c) => !read.has(c.card.itemId)).sort((a, b) => rank(a) - rank(b));
    const capLeft = Math.max(0, (o.dailyItemCap ?? 60) - await itemsReadToday(supabase));
    const take = todo.slice(0, Math.min(o.deepMax ?? 15, capLeft));
    rep.deep_cap_left = capLeft - take.length;
    await pool(take, 3, async (c) => {
      const url = c.card.url;
      const res = await fetchPage(url, { markdown: true, metadata: { kind: "item", tier: c.tier, facet: c.facet } });
      rep.calls++;
      if (!res.html || !res.markdown || res.error) { rep.errors.push(`item ${c.card.itemId}: ${res.error ?? "empty page"} (HTTP ${res.statusCode ?? "?"})`); return; }
      rep.deep_read++; rep.per_tier[`${c.tier}:${c.facet}`].fetched++;
      const page = parseItemPage(res.html, res.markdown);
      if (!page.title && !Object.keys(page.specifics).length) { rep.errors.push(`item ${c.card.itemId}: page parsed to nothing (snapshot ${res.snapshotId})`); return; }
      const item = pageToItem({ ...page, itemId: page.itemId ?? c.card.itemId }, c.card);
      const out = await landItem(supabase, item, rep, now, {
        snapshotId: res.snapshotId, source: SOURCE, method: METHOD,
        extra: { card: { ...c.card, rows: undefined }, page: { specifics: page.specifics, location: page.location, time_left_text: page.timeLeft, for_sale_by: page.forSaleBy, format: page.format, bids: page.bids, image_count: page.images.length }, listed_label: c.card.listedLabel, tier: tierOfYear(c.card.year) },
      });
      if (out === "landed") rep.per_tier[`${c.tier}:${c.facet}`].landed++;
    });
    if (todo.length > take.length) rep.stopped = `cap: ${todo.length - take.length} item pages wait (per-run ${o.deepMax ?? 15}, daily left ${capLeft})`;
  } catch (e) {
    rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400));
  }
  return finish(rep);
}

function finish(rep: DiscoverReport): DiscoverReport {
  if (rep.errors.length) rep.ok = false;
  return rep;
}

/** Re-land item pages already retained in the bucket that have no listing episode yet (a parser fix, a failed write): 0 credits. */
export async function reland(supabase: any, o: { limit?: number } = {}): Promise<Report> {
  const rep = emptyReport("reland");
  try {
    const snaps = await supabase.from("listing_page_snapshots").select("id,listing_url,html_storage_path,markdown_storage_path")
      .eq("platform", PLATFORM).eq("success", true).like("listing_url", "%/itm/%").not("markdown_storage_path", "is", null)
      .order("fetched_at", { ascending: false }).limit(Math.min(o.limit ?? 50, 200));
    if (snaps.error) throw new Error(`snapshots read failed: ${snaps.error.message}`);
    const keys = (snaps.data ?? []).map((s: any) => String(s.listing_url).split("/").pop());
    const ev = await supabase.from("vehicle_events").select("source_listing_id").eq("source_platform", PLATFORM).in("source_listing_id", keys).limit(1000);
    if (ev.error) throw new Error(`events read failed: ${ev.error.message}`);
    const have = new Set((ev.data ?? []).map((e: any) => String(e.source_listing_id)));
    const todo = (snaps.data ?? []).filter((s: any) => !have.has(String(s.listing_url).split("/").pop()));
    const now = new Date().toISOString();
    for (const s of todo) {
      const [h, m] = await Promise.all([supabase.storage.from("listing-snapshots").download(s.html_storage_path), supabase.storage.from("listing-snapshots").download(s.markdown_storage_path)]);
      if (h.error || m.error || !h.data || !m.data) { rep.errors.push(`${s.listing_url}: bucket read failed`); continue; }
      const page = parseItemPage(await h.data.text(), await m.data.text());
      const item = pageToItem({ ...page, itemId: page.itemId ?? String(s.listing_url).split("/").pop() ?? null });
      const out = await landItem(supabase, item, rep, now, { snapshotId: s.id, source: SOURCE, method: METHOD,
        extra: { page: { specifics: page.specifics, location: page.location, time_left_text: page.timeLeft, for_sale_by: page.forSaleBy, format: page.format, bids: page.bids, image_count: page.images.length }, relanded_from_snapshot: s.id } });
      if (out === "landed") rep.landed++;
    }
    rep.calls = 0;
  } catch (e) { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 400)); }
  if (rep.errors.length) rep.ok = false;
  return rep;
}
