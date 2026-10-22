/**
 * extract-bat-seller-location
 *
 * Reads BaT listing_page_snapshots (inline html, or html_storage_path in the listing-snapshots bucket via this
 * function's own deployed service access — no credentials leave the platform) and writes the seller's "Location:"
 * line into bat_seller_locations (additive table; one row per snapshot; revert = delete by run_id).
 * POST { mode?: 'manual'|'auto', limit?: number (<=500), after_id?: uuid, run_id?: string }.
 *   manual (default): one page after after_id; returns last_id to resume.
 *   auto (pg_cron 'bat-seller-location'): drains the backlog by id cursor in bat_seller_location_progress; once drained,
 *   runs at most one 'recent' pass per 20h over snapshots fetched since the previous pass.
 * Service/admin callers only (requireWriteAuth).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { parseBatLocation } from "./parse.ts";

type Row = { id: string; listing_url: string; html: string | null; html_storage_path: string | null; fetched_at?: string };

Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req); if (denied) return denied;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
  const runId = String(body.run_id || `bat-loc-${new Date().toISOString().slice(0, 10)}`);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const cols = "id, listing_url, html, html_storage_path, fetched_at";
  const base = () => sb.from("listing_page_snapshots").select(cols).eq("platform", "bat").eq("success", true);

  let mode: "manual" | "drain" | "recent" | "idle" = "manual";
  let prog: Record<string, unknown> | null = null;
  let q;
  if (body.mode === "auto") {
    const { data: p } = await sb.from("bat_seller_location_progress").select("*").eq("id", 1).maybeSingle();
    const pg: Record<string, unknown> = p ?? { id: 1, last_id: null, drained: false, batches: 0 };
    prog = pg;
    if (!pg.drained) {
      mode = "drain";
      q = base().order("id").limit(limit);
      if (pg.last_id) q = q.gt("id", pg.last_id as string);
    } else {
      const last = pg.last_recent_at ? Date.parse(pg.last_recent_at as string) : 0;
      if (Date.now() - last < 20 * 3600_000) return Response.json({ ok: true, mode: "idle" });
      mode = "recent";
      const since = (pg.recent_since as string) || new Date(Date.now() - 2 * 86400_000).toISOString();
      q = base().gt("fetched_at", since).order("fetched_at").limit(limit);
    }
  } else {
    q = base().order("id").limit(limit);
    if (body.after_id) q = q.gt("id", body.after_id);
  }
  const { data, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const rows = (data ?? []) as Row[];

  const out: Record<string, unknown>[] = [];
  const work = async (r: Row) => {
    let html = r.html;
    if (!html && r.html_storage_path) {
      const { data: blob } = await sb.storage.from("listing-snapshots").download(r.html_storage_path);
      html = blob ? await blob.text() : null;
    }
    const loc = html ? parseBatLocation(html) : null;
    if (loc) out.push({ snapshot_id: r.id, listing_url: r.listing_url, ...loc, run_id: runId });
  };
  for (let i = 0; i < rows.length; i += 10) await Promise.all(rows.slice(i, i + 10).map(work));
  if (out.length) {
    const { error: e2 } = await sb.from("bat_seller_locations").upsert(out, { onConflict: "snapshot_id", ignoreDuplicates: true });
    if (e2) return Response.json({ ok: false, error: e2.message }, { status: 500 });
  }
  const lastRow = rows.length ? rows[rows.length - 1] : null;
  if (prog) {
    const upd: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString(), batches: Number(prog.batches || 0) + 1 };
    if (mode === "drain") {
      if (lastRow) upd.last_id = lastRow.id;
      if (rows.length < limit) { upd.drained = true; upd.recent_since = new Date().toISOString(); upd.last_recent_at = new Date().toISOString(); }
    } else if (mode === "recent") {
      if (lastRow?.fetched_at) upd.recent_since = lastRow.fetched_at;
      if (rows.length < limit) upd.last_recent_at = new Date().toISOString();
    }
    const { error: e3 } = await sb.from("bat_seller_location_progress").upsert(upd, { onConflict: "id" });
    if (e3) return Response.json({ ok: false, error: e3.message }, { status: 500 });
  }
  return Response.json({ ok: true, mode, run_id: runId, processed: rows.length, found: out.length, last_id: lastRow?.id ?? null });
});
