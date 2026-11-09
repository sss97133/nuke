/**
 * extract-christies-art: Christie's artwork lots into the generic assets layer, modeled on the Bonhams art walk
 * (extract-bonhams-typesense mode art_land). Same writer (record_asset_lots), same creation fold, same bounds:
 * at most MAX_REQUESTS reads a run, 2 s apart, and the run stops on the first 403 or 429.
 *
 *   POST { "mode": "art_land" }               -> backfill: the next art sale walking back month by month from ANCHOR
 *   POST { "mode": "art_current" }            -> refresh: last month, this month and next month (upcoming -> results)
 *   POST { "mode": "art_land", "dry_run": true } -> read and map, write nothing; returns the mapped rows
 *
 * Idempotent: record_asset_lots keys the asset on identity_key (christies:{object_id}) and the observation on a content hash
 * of the result, prices and estimate, so a re-read lands nothing new and a changed result appends and supersedes.
 * Cursor: source_walk_cursors (source christies, walk results_by_month), last_page = month_offset * 1000 + sale_index.
 *
 *   POST { ..., "lot_pages": true }            -> also read up to LOT_PAGE_MAX closed lots' pages for their printed symbols
 *                                                 (symbols_list), only when CHRISTIES_LOT_PAGES=true; off by default.
 *
 * DISABLED: writes require CHRISTIES_ART_ENABLED=true; no cron is part of this change. Price and outcome semantics are
 * unproven (see christiesLot.ts). Deploy is not part of this draft.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { CHRISTIES_LOT_METHOD, decodePosition, EARLIEST, encodePosition, monthAt, type ChristiesLotRecord } from "./christiesLot.ts";
import { artSales, LOT_PAGE_GAP_MS, LOT_PAGE_MAX, Reader, saleLots, withLotPages } from "./christiesRead.ts";

const SOURCE = "christies";
const WALK = "results_by_month";
/** The backfill walks back from here; months after it are the art_current refresh's job. */
const ANCHOR = { year: 2026, month: 11 };

function okJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body, null, 2), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const denied = await requireWriteAuth(req);
  if (denied) return denied;

  const body = await req.json().catch(() => ({})) as { mode?: string; dry_run?: boolean; lot_pages?: boolean };
  const mode = body.mode ?? "art_land";
  const dryRun = body.dry_run === true;
  // Disabled by default: nothing lands until CHRISTIES_ART_ENABLED=true is set deliberately (no cron ships with this draft).
  if (!dryRun && Deno.env.get("CHRISTIES_ART_ENABLED") !== "true") {
    return okJson({ success: false, disabled: true, reason: "CHRISTIES_ART_ENABLED is not true; only dry_run is allowed" }, 403);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", projectSecretKey() ?? "");
  const reader = new Reader();
  // Lot pages: gated twice (the run asks, the deployment allows), own small budget, slower gap.
  const lotPagesOn = body.lot_pages === true && Deno.env.get("CHRISTIES_LOT_PAGES") === "true";
  const pageReader = new Reader(lotPagesOn ? LOT_PAGE_MAX : 0, LOT_PAGE_GAP_MS);
  let lotPagesRead = 0;
  const landed: Record<string, unknown>[] = [];
  const mappedRows: ChristiesLotRecord[] = [];

  const land = async (input: ChristiesLotRecord[]) => {
    if (!input.length) return null;
    let records = input;
    if (lotPagesOn && !pageReader.exhausted) {
      const r = await withLotPages(pageReader, records);
      records = r.records; lotPagesRead += r.read;
      if (r.status === 403 || r.status === 429 || r.status === 408) pageReader.stop(); // no more page reads this run
    }
    if (dryRun) { mappedRows.push(...records); return null; }
    const { data, error } = await supabase.rpc("record_asset_lots", { p_source_slug: SOURCE, p_lots: records });
    if (error) throw new Error(`record_asset_lots failed: ${error.message}`);
    landed.push(data as Record<string, unknown>);
    return data;
  };

  try {
    if (mode === "art_current") {
      // Last month, this month, next month: sales that are upcoming, live or newly closed. Re-reads are free (same hash).
      const now = new Date();
      const here = { year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 };
      for (const off of [-1, 0, 1]) {
        const m = monthAt(here, off);
        const { status, sales } = await artSales(reader, m.year, m.month);
        if (status === 403 || status === 429 || status === 408) return okJson({ success: false, backoff: true, upstream_status: status, landed });
        for (const ev of sales) {
          if (reader.exhausted) break;
          const r = await saleLots(reader, ev, { page: 0, pass: 0 });
          if (r.status === 403 || r.status === 429 || r.status === 408) return okJson({ success: false, backoff: true, upstream_status: r.status, landed });
          await land(r.records);
        }
        if (reader.exhausted) break;
      }
    } else if (mode === "art_land") {
      const { data: cur, error: curErr } = await supabase.from("source_walk_cursors").select("pass, last_page")
        .eq("source_slug", SOURCE).eq("walk", WALK).maybeSingle();
      if (curErr) return okJson({ success: false, error: `cursor read failed: ${curErr.message}` }, 503);
      const pass = Number(cur?.pass) || 0;
      let { monthOffset, saleIndex } = decodePosition(Number(cur?.last_page) || 0);
      let position = encodePosition(monthOffset, saleIndex);
      while (!reader.exhausted) {
        const m = monthAt(ANCHOR, monthOffset);
        if (m.year * 12 + m.month < EARLIEST.year * 12 + EARLIEST.month) { monthOffset = 0; saleIndex = 0; break; }
        const { status, sales } = await artSales(reader, m.year, m.month);
        if (status === 403 || status === 429 || status === 408) return okJson({ success: false, backoff: true, upstream_status: status, landed });
        if (saleIndex >= sales.length) { monthOffset += 1; saleIndex = 0; position = encodePosition(monthOffset, saleIndex); continue; }
        const r = await saleLots(reader, sales[saleIndex], { page: encodePosition(monthOffset, saleIndex), pass });
        if (r.status === 403 || r.status === 429 || r.status === 408) return okJson({ success: false, backoff: true, upstream_status: r.status, landed });
        await land(r.records);
        if (!r.complete) break; // the sale is re-read from page 1 next run; landing is idempotent
        saleIndex += 1;
        position = encodePosition(monthOffset, saleIndex);
      }
      if (!dryRun) {
        const { error: wErr } = await supabase.from("source_walk_cursors").upsert(
          { source_slug: SOURCE, walk: WALK, pass, last_page: Math.max(1, position), updated_at: new Date().toISOString() },
          { onConflict: "source_slug,walk" });
        if (wErr) console.error(`[christies] cursor write failed: ${wErr.message}`);
      }
    } else {
      return okJson({ success: false, error: `unknown mode ${mode}` }, 400);
    }

    let creation: unknown = null;
    const newObs = landed.reduce((a, r) => a + (Number(r.observations_new) || 0), 0);
    if (!dryRun && newObs > 0) {
      const { data, error } = await supabase.rpc("fold_asset_creation_claims", { p_source_slug: SOURCE, p_limit: Math.min(newObs + 100, 1000) });
      creation = error ? { error: error.message } : data;
    }
    return okJson({
      success: true, mode, dry_run: dryRun, method: CHRISTIES_LOT_METHOD, requests: reader.requests, lot_pages: lotPagesOn, lot_pages_read: lotPagesRead,
      landed, creation, mapped: dryRun ? mappedRows : undefined,
    });
  } catch (e) {
    return okJson({ success: false, error: e instanceof Error ? e.message : String(e), landed }, 500);
  }
});
