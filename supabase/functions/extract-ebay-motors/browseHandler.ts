/** HTTP surface of the Browse intake: POST {action: sweep | revisit | aspects | status | preview}. */
import { corsHeaders } from "../_shared/cors.ts";
import { htmlToText } from "../_shared/htmlToText.ts";
import { BrowseClient, yearAspect } from "./browseApi.ts";
import { revisit, sweep } from "./browseSweep.ts";
import { toLanding } from "./browseMap.ts";
import { emptyReport } from "./browseSweep.ts";
import { landArchived, validCaptures } from "./archiveLand.ts";

export const BROWSE_ACTIONS = ["sweep", "revisit", "aspects", "status", "preview", "archive"];
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
