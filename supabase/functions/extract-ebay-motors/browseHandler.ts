/** HTTP surface of the Browse intake: POST {action: sweep | revisit | auctions | aspects | status | preview | archive | census |
 *  place | honour_deletions | member_handles}. */
import { corsHeaders } from "../_shared/cors.ts";
import { htmlToText } from "../_shared/htmlToText.ts";
import { BrowseClient, yearAspect } from "./browseApi.ts";
import { revisit, sweep } from "./browseSweep.ts";
import { auctions } from "./browseAuctions.ts";
import { toLanding } from "./browseMap.ts";
import { censusRow, readCensus } from "./browseCensus.ts";
import { emptyReport } from "./browseSweep.ts";
import { landArchived, validCaptures } from "./archiveLand.ts";
import { placeBackfill } from "./browsePlace.ts";
import { deletedLookup, honourDeletions, readStoredHandles, tombstoneItem } from "./deletedMembers.ts";

export const BROWSE_ACTIONS = ["sweep", "revisit", "auctions", "aspects", "status", "preview", "archive", "census", "place", "honour_deletions", "member_handles"];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleBrowse(supabase: any, body: any): Promise<Response> {
  if (body.action === "archive") {     // archived item pages (Wayback Machine captures): free; clocks are the capture's
    const caps = validCaptures(body.captures);
    if (!caps.length) return json({ ok: false, error: "captures: [{ timestamp: 'YYYYMMDDhhmmss', original: 'http://cgi.ebay.com/...' }] (max 10)" }, 400);
    const rep = emptyReport(body.dry_run === true ? "archive_dry_run" : "archive");
    const results = [];
    for (const c of caps) results.push(await landArchived(supabase, c, rep, body.dry_run === true));
    if (rep.errors.length) rep.ok = false;
    return json({ ...rep, results }, 200);
  }
  if (body.action === "place") {       // back-fill: the stated place of listings landed before landing wrote it; reads our own rows only
    const rep = await placeBackfill(supabase, { max: body.max, after: body.after ?? null, dryRun: body.dry_run === true });
    return json(rep, rep.ok ? 200 : 500);
  }
  if (body.action === "honour_deletions") {   // eBay account deletions: every copy of a deleted member's handle redacted (cron ebay-deletion-honour)
    const rep = await honourDeletions(supabase, { dryRun: body.dry_run === true, budgetMs: body.budget_ms });
    return json(rep, rep.ok ? 200 : 500);
  }
  if (body.action === "member_handles") {     // stored pages read once for the member handles they name (hashes into metadata)
    const rep = await readStoredHandles(supabase, { after: body.after ?? null, listings: body.listings });
    return json(rep, rep.ok ? 200 : 500);
  }
  if (!Deno.env.get("EBAY_CLIENT_ID") || !Deno.env.get("EBAY_CLIENT_SECRET")) {
    return json({ ok: false, error: "EBAY_CLIENT_ID / EBAY_CLIENT_SECRET are not set; nothing was called" }, 503);
  }
  const client = new BrowseClient();
  try {
    switch (body.action) {
      case "status":
        return json({ ok: true, quota: await client.remainingToday(), calls: client.calls });
      case "aspects": {
        const dist = await client.aspectRefinements();
        const ya = yearAspect(dist);
        return json({ ok: true, aspect_names: dist.map((d) => d.localizedAspectName), year_aspect: ya?.name ?? null,
          year_counts: ya ? Object.fromEntries([...ya.counts].sort((a, b) => a[0] - b[0])) : null, calls: client.calls });
      }
      case "preview": {          // one item read and mapped, nothing written: for the raw-vs-model gate
        const raw = (await tombstoneItem(deletedLookup(supabase), await client.getItem(String(body.item_id)))).raw;
        return json({ ok: true, raw, landing: toLanding(raw, htmlToText), calls: client.calls });
      }
      case "census": {           // eBay's own counts, one source_census row: category total, make, year, vintage by ZIP prefix, near-me per anchor
        const r = await readCensus(client);
        const src = await supabase.from("observation_sources").select("id").eq("slug", "ebay_motors").maybeSingle();
        if (!src.data?.id) return json({ ok: false, error: "observation_sources has no ebay_motors row", reading: { total: r.total } }, 500);
        const ins = await supabase.from("source_census").insert(censusRow(src.data.id, r));
        if (ins.error) return json({ ok: false, error: `source_census insert: ${ins.error.message}`, total: r.total }, 500);
        return json({ ok: true, as_of: r.as_of, total: r.total, vintage_le_1991: r.vintage.total, vintage_read: r.vintage.read, vintage_skipped: r.vintage.skipped,
          zip3_areas: Object.keys(r.vintage.by_zip3).length, local_pickup: r.local_pickup, calls: r.calls });
      }
      case "revisit": {
        const rep = await revisit(supabase, client, { max: body.max });
        return json(rep, rep.ok ? 200 : 500);
      }
      case "auctions": {         // open auctions -> the live board (browseAuctions.ts); cron ebay-motors-auctions / -pass
        const rep = await auctions(supabase, client, {
          maxPages: body.max_pages, maxItems: body.max_items, maxCalls: body.max_calls, dailyCap: body.daily_cap, floor: body.floor, blindCap: body.blind_cap,
          maxEnded: body.max_ended, minMinutesLeft: body.min_minutes_left, dryRun: body.dry_run === true,
        });
        return json(rep, rep.ok ? 200 : 500);
      }
      default: {
        const rep = await sweep(supabase, client, {
          tiers: body.tiers, maxSearchPages: body.max_search_pages, maxItems: body.max_items, reserveCalls: body.reserve_calls,
          blindCap: body.blind_cap, dryRun: body.dry_run === true, concurrency: body.concurrency,
        });
        return json(rep, rep.ok ? 200 : 500);
      }
    }
  } catch (e) {
    return json({ ok: false, error: (e as Error).message.slice(0, 500), calls: client.calls }, 500);
  }
}
