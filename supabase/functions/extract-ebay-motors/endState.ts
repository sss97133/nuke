/**
 * How an eBay listing we hold ended, from eBay's public pages (Firecrawl), at a few credits a day.
 *
 *   census   the live private-seller listings per tier, read from the facet search pages (pages = ceil(total / 240); 1 credit each).
 *            A held listing missing from its tier's census is a candidate for ended; the census is complete only when every
 *            page was read, and a candidate is never marked ended on the census alone.
 *   confirm  one item page per candidate (1 credit): "Ended" with the end time and the price shown -> the episode is `ended`.
 *            Still live -> last_checked_at only. eBay's public page does not say sold or unsold, so the outcome is recorded as
 *            what the page shows: auction with no bids, auction with bids (high bid shown), or fixed-price ended. Never "sold".
 *   Order    auctions past their estimated end first, then tier 1 before tier 2, oldest check first. Capped per run and per day.
 */
import { writeVehicleEventByKey } from "../_shared/vehicleEventWrite.ts";
import { emptyReport, PLATFORM, pool, type Report } from "./browseSweep.ts";
import { type Facet, parseSearchCards, resultCount, searchUrl } from "./ebayPage.ts";
import { TIERS } from "./browseMap.ts";
import type { PageFetcher } from "./retain.ts";

const MON: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** "Ends in 6d 19h" / "Time left: 29d 17h | 11/13, 08:53 PM" -> an estimated end time, from when the page was read. */
export function estimateEnd(md: string, fetchedAt: Date): { at: Date; basis: string } | null {
  const m = md.match(/Ends in\s+((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?)/) ?? md.match(/Time left:\s*((?:\d+d)?\s*(?:\d+h)?\s*(?:\d+m)?)/);
  if (!m || !m[1].trim()) return null;
  const d = Number(m[1].match(/(\d+)d/)?.[1] ?? 0), h = Number(m[1].match(/(\d+)h/)?.[1] ?? 0), mi = Number(m[1].match(/(\d+)m/)?.[1] ?? 0);
  return { at: new Date(fetchedAt.getTime() + ((d * 24 + h) * 60 + mi) * 60_000), basis: `page read ${fetchedAt.toISOString()} + ${m[1].trim()}` };
}

export interface EndedPage { ended: boolean; endedLabel: string | null; endedAt: string | null; priceText: string | null; price: number | null; bids: number | null; auction: boolean }

/** An ended item page leads with "Ended", the price shown and the end time ("Sun, Jan 25, 05:42 PM"; zone not stated). */
export function parseEndedPage(md: string, status: number | null, now: Date): EndedPage {
  const head = md.slice(0, 2500);
  const ended = /(^|\n)Ended\s*(\n|$)/.test(head) || /(^|\n)ENDED\s*(\n|$)/.test(head) || /This listing (has )?ended/i.test(head) || (status === 404 && /\bEnded\b/.test(head));
  const label = head.match(/\b(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([A-Z][a-z]{2}) (\d{1,2}), (\d{1,2}):(\d{2}) (AM|PM)/);
  let endedAt: string | null = null;
  if (label) {
    let hh = Number(label[3]) % 12 + (label[5] === "PM" ? 12 : 0);
    let t = Date.UTC(now.getUTCFullYear(), MON[label[1].toLowerCase()], Number(label[2]), hh, Number(label[4]));
    if (t > now.getTime() + 86_400_000) t = Date.UTC(now.getUTCFullYear() - 1, MON[label[1].toLowerCase()], Number(label[2]), hh, Number(label[4]));
    endedAt = new Date(t).toISOString();
  }
  const priceText = head.match(/US (\$[\d,]+(?:\.\d\d)?)/)?.[1] ?? null;
  const bids = head.match(/\b(\d+) bids?\b/)?.[1];
  return { ended, endedLabel: label?.[0] ?? null, endedAt, priceText, price: priceText ? Number(priceText.replace(/[^\d.]/g, "")) : null,
    bids: bids ? Number(bids) : null, auction: /\bbids?\b|Winning bid|Starting bid/i.test(head) };
}

export function outcomeOf(p: EndedPage, format: string | null): string {
  const auction = format === "auction" || p.auction;
  if (auction) return (p.bids ?? 0) > 0 ? "auction_ended_with_bids" : "auction_ended_no_bids_shown";
  return "listing_ended";
}

export async function census(fetchPage: PageFetcher, tierIds = [1, 2], facet: Facet = "private"): Promise<{ ids: Map<number, Set<string>>; complete: Map<number, boolean>; pages: number; errors: string[] }> {
  const ids = new Map<number, Set<string>>(), complete = new Map<number, boolean>(), errors: string[] = [];
  let pages = 0;
  for (const tier of TIERS.filter((t) => tierIds.includes(t.id))) {
    const set = new Set<string>(); ids.set(tier.id, set); complete.set(tier.id, false);
    let total: number | null = null;
    for (let p = 1; p <= 6; p++) {
      const res = await fetchPage(searchUrl(tier.years, facet, p), { markdown: false, metadata: { kind: "census", tier: tier.id, facet, page: p } });
      pages++;
      if (!res.html || res.error) { errors.push(`census ${tier.id} p${p}: ${res.error ?? "empty"}`); break; }
      const cards = parseSearchCards(res.html);
      if (p === 1) total = resultCount(res.html);
      cards.forEach((c) => set.add(c.itemId));
      if (cards.length === 0) { errors.push(`census ${tier.id} p${p}: 0 cards`); break; }
      if (total != null && p * 240 >= total) { complete.set(tier.id, set.size >= Math.min(total, 1440) * 0.9); break; }
    }
  }
  return { ids, complete, pages, errors };
}

export interface EndOptions { confirmMax?: number; dailyCap?: number; dryRun?: boolean; tiers?: number[]; skipCensus?: boolean }

export async function endcheck(supabase: any, fetchPage: PageFetcher, o: EndOptions = {}): Promise<Report & { census_pages: number; candidates: number; confirmed_ended: number; still_live: number; census_complete: Record<string, boolean> }> {
  const rep: any = { ...emptyReport(o.dryRun ? "endcheck_dry_run" : "endcheck"), census_pages: 0, candidates: 0, confirmed_ended: 0, still_live: 0, census_complete: {} };
  try {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const used = await supabase.from("listing_page_snapshots").select("id", { count: "exact", head: true }).eq("platform", PLATFORM)
      .eq("fetch_method", "firecrawl").gte("fetched_at", since.toISOString()).or("metadata->>kind.eq.census,metadata->>kind.eq.endcheck");
    if (used.error) throw new Error(`daily count failed: ${used.error.message}`);
    const left = Math.max(0, (o.dailyCap ?? 30) - (used.count ?? 0));
    const tierIds = o.tiers ?? [1, 2];
    const live = await supabase.from("vehicle_events").select("id,vehicle_id,source_listing_id,source_url,metadata,created_at")
      .eq("source_platform", PLATFORM).eq("event_type", "listing").neq("event_status", "ended").limit(2500);
    if (live.error) throw new Error(`live read failed: ${live.error.message}`);
    // candidates: in a tier whose census was read completely and not in it, landed from the private facet
    let cand: any[] = [];
    if (!o.skipCensus && left > 0) {
      const c = await census(fetchPage, tierIds);
      rep.census_pages = c.pages; rep.errors.push(...c.errors);
      for (const [t, ok] of c.complete) rep.census_complete[t] = ok;
      cand = (live.data ?? []).filter((e: any) => {
        const t = Number(e.metadata?.tier);
        return tierIds.includes(t) && c.complete.get(t) && !c.ids.get(t)!.has(String(e.source_listing_id))
          && Date.now() - Date.parse(e.created_at) > 6 * 3600_000 && !(e.metadata?.last_checked_at && Date.now() - Date.parse(e.metadata.last_checked_at) < 3 * 86400_000);
      });
    }
    rep.candidates = cand.length;
    cand.sort((a, b) => Number(a.metadata?.tier) - Number(b.metadata?.tier) || Date.parse(a.created_at) - Date.parse(b.created_at));
    if (o.dryRun) { rep.stopped = "dry run"; return rep; }
    const take = cand.slice(0, Math.max(0, Math.min(o.confirmMax ?? 24, left - rep.census_pages)));
    await pool(take, 2, async (e: any) => {
      const key = String(e.source_listing_id), now = new Date();
      const res = await fetchPage(`https://www.ebay.com/itm/${key}`, { markdown: true, metadata: { kind: "endcheck", tier: e.metadata?.tier } });
      rep.calls++;
      if (!res.markdown || res.error) { rep.errors.push(`${key}: ${res.error ?? "empty page"}`); return; }
      const p = parseEndedPage(res.markdown, res.statusCode, now);
      if (!p.ended) {
        rep.still_live++;
        const w = await writeVehicleEventByKey(supabase, { vehicle_id: e.vehicle_id, source_platform: PLATFORM, source_listing_id: key, source_url: e.source_url, event_type: "listing", updated_at: now.toISOString(),
          metadata: { last_checked_at: now.toISOString(), checked_live_after_census_miss: true } }, { preserveEventStatus: true, sourceObservedAt: now.toISOString() });
        if (w.action === "error") rep.errors.push(`live stamp ${key}: ${w.error}`);
        return;
      }
      const fmt = e.metadata?.page?.page?.format ?? null;
      const endedAt = p.endedAt ?? now.toISOString();
      const posted = e.metadata?.page?.listed_label ?? e.metadata?.listing_posted_at ?? null;
      const w = await writeVehicleEventByKey(supabase, { vehicle_id: e.vehicle_id, source_platform: PLATFORM, source_listing_id: key, source_url: e.source_url, event_type: "listing",
        event_status: "ended", ended_at: endedAt, updated_at: now.toISOString(),
        metadata: { last_checked_at: now.toISOString(), source_observed_at: now.toISOString(), snapshot_id: res.snapshotId,
          end_state: { outcome: outcomeOf(p, fmt), basis: "ended item page", ended_label: p.endedLabel, ended_at_zone: "not stated by eBay", price_shown: p.price, bids_shown: p.bids,
            note: "eBay's public page does not say sold or unsold; this is what the page shows", listed_label: posted, detected_by: "census miss + item page" } } },
        { sourceObservedAt: now.toISOString() });
      if (w.action === "error") rep.errors.push(`ended ${key}: ${w.error}`); else rep.confirmed_ended++;
    });
    if (cand.length > take.length) rep.stopped = `cap: ${cand.length - take.length} candidates wait`;
  } catch (e) { rep.ok = false; rep.errors.push((e as Error).message.slice(0, 300)); }
  rep.calls += rep.census_pages;
  if (rep.errors.length) rep.ok = false;
  return rep;
}
