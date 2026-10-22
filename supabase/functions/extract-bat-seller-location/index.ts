/**
 * extract-bat-seller-location
 *
 * Reads BaT listing_page_snapshots (inline html, or html_storage_path in the listing-snapshots bucket via this
 * function's own deployed service access — no credentials leave the platform) and writes the seller's "Location:"
 * line into bat_seller_locations (additive table; one row per snapshot; revert = delete by run_id).
 * POST { limit?: number (<=500), after_id?: uuid, run_id?: string }. Returns { processed, found, last_id }.
 * Resumable: pass last_id back as after_id. Service/admin callers only (requireWriteAuth).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { parseBatLocation } from "./parse.ts";

Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req); if (denied) return denied;
  const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
  const limit = Math.min(Math.max(Number(body.limit) || 200, 1), 500);
  const runId = String(body.run_id || `bat-loc-${new Date().toISOString().slice(0, 10)}`);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  let q = sb.from("listing_page_snapshots").select("id, listing_url, html, html_storage_path")
    .eq("platform", "bat").eq("success", true).order("id").limit(limit);
  if (body.after_id) q = q.gt("id", body.after_id);
  const { data: rows, error } = await q;
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });
  const out: Record<string, unknown>[] = [];
  for (const r of rows ?? []) {
    let html: string | null = r.html;
    if (!html && r.html_storage_path) {
      const { data: blob } = await sb.storage.from("listing-snapshots").download(r.html_storage_path);
      html = blob ? await blob.text() : null;
    }
    const loc = html ? parseBatLocation(html) : null;
    if (loc) out.push({ snapshot_id: r.id, listing_url: r.listing_url, ...loc, run_id: runId });
  }
  if (out.length) {
    const { error: e2 } = await sb.from("bat_seller_locations").upsert(out, { onConflict: "snapshot_id", ignoreDuplicates: true });
    if (e2) return Response.json({ ok: false, error: e2.message }, { status: 500 });
  }
  const last = rows?.length ? rows[rows.length - 1].id : null;
  return Response.json({ ok: true, run_id: runId, processed: rows?.length ?? 0, found: out.length, last_id: last });
});
