/** HTTP surface of the Browse intake: POST {action: sweep | revisit | aspects | status | preview}. */
import { corsHeaders } from "../_shared/cors.ts";
import { htmlToText } from "../_shared/htmlToText.ts";
import { BrowseClient, yearAspect } from "./browseApi.ts";
import { revisit, sweep } from "./browseSweep.ts";
import { toLanding } from "./browseMap.ts";
import { firecrawlFetcher } from "./retain.ts";
import { discover, reland } from "./firecrawlSweep.ts";
import { emptyReport, landItem } from "./browseSweep.ts";
import { pageToItem, parseItemPage } from "./ebayPage.ts";

export const BROWSE_ACTIONS = ["sweep", "revisit", "aspects", "status", "preview", "discover", "deep", "reland"];
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

export async function handleBrowse(supabase: any, body: any): Promise<Response> {
  // Firecrawl door: eBay's public pages, no developer account.
  if (body.action === "discover") {
    const rep = await discover(supabase, {
      tiers: body.tiers, facets: body.facets, jobs: body.jobs, pages: body.pages, deepMax: body.deep_max, dailyItemCap: body.daily_item_cap, dryRun: body.dry_run === true, backfill: body.backfill === true,
    });
    return json(rep, rep.ok ? 200 : 500);
  }
  if (body.action === "reland") { const rep = await reland(supabase, { limit: body.limit, offset: body.offset }); return json(rep, rep.ok ? 200 : 500); }
  if (body.action === "deep") {         // one item page: read, parse, and (unless dry_run) land
    const url = String(body.url ?? "");
    if (!/^https:\/\/(www\.)?ebay\.com\/itm\/\d{6,}/.test(url)) return json({ ok: false, error: "url must be an ebay.com/itm/<id> link" }, 400);
    const res = await firecrawlFetcher(supabase, "ebay_motors")(url, { markdown: true, metadata: { kind: "item", via: "deep" } });
    if (!res.html || !res.markdown || res.error) return json({ ok: false, error: res.error ?? "empty page", status: res.statusCode }, 502);
    const page = parseItemPage(res.html, res.markdown);
    const item = pageToItem(page);
    if (body.dry_run === true) return json({ ok: true, snapshot_id: res.snapshotId, page: { ...page, description: page.description.slice(0, 1500) }, landing: toLanding(item, htmlToText, "ebay-firecrawl") });
    const rep = emptyReport("deep");
    const out = await landItem(supabase, item, rep, new Date().toISOString(), { snapshotId: res.snapshotId, source: "ebay-firecrawl", method: "ebay_firecrawl_v1",
      extra: { page: { specifics: page.specifics, location: page.location, time_left_text: page.timeLeft, for_sale_by: page.forSaleBy, format: page.format, bids: page.bids, image_count: page.images.length } } });
    if (rep.errors.length) rep.ok = false;
    return json({ ...rep, result: out, snapshot_id: res.snapshotId }, rep.ok ? 200 : 500);
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
        const raw = await client.getItem(String(body.item_id));
        return json({ ok: true, raw, landing: toLanding(raw, htmlToText), calls: client.calls });
      }
      case "revisit": {
        const rep = await revisit(supabase, client, { max: body.max });
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
