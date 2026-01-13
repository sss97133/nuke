/**
 * bat-multisignal-postprocess
 *
 * Minimal “fix it now” multisignal helper:
 * - Ensures auction_events rows exist for a current BaT listing + optional prior listing
 * - Inserts auction_event_links edge (relist_of)
 * - Creates one timeline_events row per “repair claim” found in the stored BaT description
 *
 * Goals:
 * - Small + idempotent (safe to re-run)
 * - Stores provenance in timeline_events.metadata
 * - Leaves room for future scaling (automatic prior-link detection, receipt OCR, etc.)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    if (!u.pathname.endsWith("/")) u.pathname = `${u.pathname}/`;
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base : `${base}/`;
  }
}

function canonicalUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    u.search = "";
    // Prefer canonical URLs without trailing slash (matches much of existing DB)
    if (u.pathname.endsWith("/")) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch {
    const base = String(raw || "").split("#")[0].split("?")[0];
    return base.endsWith("/") ? base.slice(0, -1) : base;
  }
}

function uniq<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function toYmdFromIsoTs(ts: string | null | undefined): string | null {
  const s = String(ts || "").trim();
  if (!s) return null;
  // Handles `2025-05-17T00:00:00.000Z` or `2025-05-17 00:00:00+00`
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? null;
}

function toIsoMidnightZ(ymd: string | null): string | null {
  if (!ymd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  return `${ymd}T00:00:00.000Z`;
}

function cleanRepairItem(raw: string): string | null {
  let s = String(raw || "").trim();
  if (!s) return null;
  s = s.replace(/^[,.;:\-\s]+/, "").replace(/[,.;:\-\s]+$/, "").trim();
  s = s.replace(/^and\s+/i, "").trim();
  s = s.replace(/^included\s+/i, "").trim();
  s = s.replace(/^including\s+/i, "").trim();
  s = s.replace(/\s+/g, " ").trim();
  if (!s) return null;
  // Avoid extremely short junk fragments
  if (s.length < 4) return null;
  return s;
}

function splitRepairPhraseList(text: string): string[] {
  const base = String(text || "").trim();
  if (!base) return [];

  // Normalize some common joiners so a simple split works reasonably well.
  let s = base;
  s = s.replace(/(?:,?\s+and\s+more.*)$/i, ""); // drop “and more …”
  s = s.replace(/\s*\(.*?\)\s*/g, " "); // drop parentheticals (best-effort)
  s = s.replace(/;\s*/g, ", ");
  s = s.replace(/\s+along with\s+/gi, ", ");
  s = s.replace(/\s+as well as\s+/gi, ", ");
  s = s.replace(/\s+plus\s+/gi, ", ");
  s = s.replace(/\s+/g, " ").trim();

  const chunks = s.split(",").map((c) => c.trim()).filter(Boolean);
  const out: string[] = [];
  for (const c of chunks) {
    // Second pass: split “x and y” when it looks like a list.
    const parts = c.split(/\s+\band\b\s+/i).map((p) => p.trim()).filter(Boolean);
    if (parts.length > 1) out.push(...parts);
    else out.push(c);
  }

  const cleaned = out.map(cleanRepairItem).filter((x): x is string => Boolean(x));

  // Best-effort context propagation: if we see "rear brake calipers, rotors, pads, and lines"
  // we want: "rear brake calipers", "rear brake rotors", "rear brake pads", "rear brake lines".
  const propagated: string[] = [];
  let listPrefix: string | null = null;
  const prefixIsUseful = (p: string) => /\b(brake|rear|front)\b/i.test(p);
  const computePrefix = (item: string): string | null => {
    const t = String(item || "").trim().replace(/^(the|a|an)\s+/i, "").trim();
    const words = t.split(/\s+/).filter(Boolean);
    if (words.length < 2) return null;
    const prefix = words.slice(0, -1).join(" ").trim();
    return prefix || null;
  };
  for (const item of cleaned) {
    const isSingleToken = !/\s/.test(item);
    if (isSingleToken && listPrefix) {
      const combined = `${listPrefix} ${item}`.trim();
      propagated.push(combined);
      const p2 = computePrefix(combined);
      listPrefix = p2 && prefixIsUseful(p2) ? p2 : listPrefix;
      continue;
    }

    propagated.push(item);
    const p = computePrefix(item);
    listPrefix = p && prefixIsUseful(p) ? p : null;
  }

  return propagated;
}

function extractRepairClaims(description: string): { item: string; evidence: string }[] {
  const text = String(description || "").replace(/\s+/g, " ").trim();
  if (!text) return [];

  const candidates: { item: string; evidence: string }[] = [];

  const patterns: RegExp[] = [
    /Work under current ownership included\s+([^\.]{20,600})\./gi,
    /Under current ownership[, ]+\s*([^\.]{20,600})\./gi,
  ];

  for (const re of patterns) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      const evidence = m[0];
      const body = m[1] || "";
      const items = splitRepairPhraseList(body);
      for (const item of items) candidates.push({ item, evidence });
    }
  }

  // De-dupe by item text (keep first evidence)
  const seen = new Set<string>();
  const out: { item: string; evidence: string }[] = [];
  for (const c of candidates) {
    const key = c.item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

async function resolveVehicleIdByUrlCandidates(args: {
  supabase: any;
  urlCandidates: string[];
}): Promise<string | null> {
  const { supabase, urlCandidates } = args;
  if (!urlCandidates.length) return null;

  // 1) auction_events → vehicle_id
  const { data: ev } = await supabase
    .from("auction_events")
    .select("vehicle_id")
    .eq("source", "bat")
    .in("source_url", urlCandidates)
    .limit(1)
    .maybeSingle();
  if (ev?.vehicle_id) return String(ev.vehicle_id);

  // 2) external_listings → vehicle_id
  const { data: ext } = await supabase
    .from("external_listings")
    .select("vehicle_id")
    .eq("platform", "bat")
    .in("listing_url", urlCandidates)
    .limit(1)
    .maybeSingle();
  if (ext?.vehicle_id) return String(ext.vehicle_id);

  // 3) vehicles URLs
  const { data: v1 } = await supabase
    .from("vehicles")
    .select("id")
    .in("bat_auction_url", urlCandidates)
    .limit(1)
    .maybeSingle();
  if (v1?.id) return String(v1.id);

  const { data: v2 } = await supabase
    .from("vehicles")
    .select("id")
    .in("discovery_url", urlCandidates)
    .limit(1)
    .maybeSingle();
  if (v2?.id) return String(v2.id);

  return null;
}

async function ensureAuctionEvent(args: {
  supabase: any;
  vehicleId: string;
  listingUrlCanonical: string;
  urlCandidates: string[];
}): Promise<{ id: string; auction_end_date: string | null }> {
  const { supabase, vehicleId, listingUrlCanonical, urlCandidates } = args;

  const { data: existing } = await supabase
    .from("auction_events")
    .select("id, auction_end_date")
    .eq("source", "bat")
    .eq("vehicle_id", vehicleId)
    .in("source_url", urlCandidates)
    .limit(1)
    .maybeSingle();

  if (existing?.id) {
    return {
      id: String(existing.id),
      auction_end_date: existing.auction_end_date ? String(existing.auction_end_date) : null,
    };
  }

  // Stub row (will be filled by extract-bat-core later). Use upsert for idempotency.
  const { data: inserted, error } = await supabase
    .from("auction_events")
    .upsert(
      {
        vehicle_id: vehicleId,
        source: "bat",
        source_url: listingUrlCanonical,
        outcome: "pending",
        raw_data: { extractor: "bat-multisignal-postprocess", stub: true, listing_url: listingUrlCanonical },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "vehicle_id,source_url" },
    )
    .select("id, auction_end_date")
    .single();

  if (error) throw new Error(`auction_events stub upsert failed: ${error.message}`);
  return {
    id: String(inserted.id),
    auction_end_date: inserted.auction_end_date ? String(inserted.auction_end_date) : null,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
    const serviceRoleKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
    if (!supabaseUrl) throw new Error("Missing SUPABASE_URL");
    if (!serviceRoleKey) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");

    const supabase = createClient(supabaseUrl, serviceRoleKey);

    const body = await req.json().catch(() => ({}));
    const listingUrlRaw = String(body?.listing_url || body?.url || "").trim();
    const priorListingUrlRaw = body?.prior_listing_url ? String(body.prior_listing_url).trim() : "";

    const createLinks = body?.create_links === false ? false : true;
    const createRepairs = body?.create_repairs === false ? false : true;
    const dryRun = body?.dry_run === true;

    if (!listingUrlRaw || !listingUrlRaw.includes("bringatrailer.com/listing/")) {
      return new Response(JSON.stringify({ error: "Invalid listing_url (expected bringatrailer.com/listing/...)" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const listingUrlNorm = normalizeUrl(listingUrlRaw);
    const listingUrlCanon = canonicalUrl(listingUrlRaw);
    const listingUrlCandidates = uniq([
      listingUrlRaw,
      listingUrlNorm,
      listingUrlCanon,
      listingUrlCanon.endsWith("/") ? listingUrlCanon.slice(0, -1) : `${listingUrlCanon}/`,
    ].filter(Boolean));

    let vehicleId: string | null = body?.vehicle_id ? String(body.vehicle_id) : null;
    if (!vehicleId) {
      vehicleId = await resolveVehicleIdByUrlCandidates({ supabase, urlCandidates: listingUrlCandidates });
    }
    if (!vehicleId) {
      return new Response(JSON.stringify({
        error: "Missing vehicle_id (and could not resolve it by listing URL). Run extract-bat-core with vehicle_id first.",
      }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const currentEvent = await ensureAuctionEvent({
      supabase,
      vehicleId,
      listingUrlCanonical: listingUrlCanon,
      urlCandidates: listingUrlCandidates,
    });

    let priorEvent: { id: string; auction_end_date: string | null } | null = null;
    let priorUrlCanon: string | null = null;
    if (priorListingUrlRaw) {
      priorUrlCanon = canonicalUrl(priorListingUrlRaw);
      const priorUrlNorm = normalizeUrl(priorListingUrlRaw);
      const priorUrlCandidates = uniq([
        priorListingUrlRaw,
        priorUrlNorm,
        priorUrlCanon,
        priorUrlCanon.endsWith("/") ? priorUrlCanon.slice(0, -1) : `${priorUrlCanon}/`,
      ].filter(Boolean));

      priorEvent = await ensureAuctionEvent({
        supabase,
        vehicleId,
        listingUrlCanonical: priorUrlCanon,
        urlCandidates: priorUrlCandidates,
      });
    }

    const windowAfterYmd = toYmdFromIsoTs(priorEvent?.auction_end_date ?? null);
    const windowBeforeYmd = toYmdFromIsoTs(currentEvent.auction_end_date ?? null);

    const output: any = {
      success: true,
      vehicle_id: vehicleId,
      current: { listing_url: listingUrlCanon, auction_event_id: currentEvent.id, auction_end_date: currentEvent.auction_end_date },
      prior: priorEvent ? { listing_url: priorUrlCanon, auction_event_id: priorEvent.id, auction_end_date: priorEvent.auction_end_date } : null,
      created: { links: 0, repairs: 0 },
      skipped: { repairs_existing: 0 },
      window: { after: windowAfterYmd, before: windowBeforeYmd },
      dry_run: dryRun,
    };

    // 1) Link the two auctions (relist chain)
    if (createLinks && priorEvent) {
      if (!dryRun) {
        const { error } = await supabase
          .from("auction_event_links")
          .upsert(
            {
              from_auction_event_id: priorEvent.id,
              to_auction_event_id: currentEvent.id,
              link_type: "relist_of",
              evidence: {
                evidence: "manual_prior_listing_url",
                confidence: 1.0,
                prior_listing_url: priorUrlCanon,
                current_listing_url: listingUrlCanon,
              },
              updated_at: new Date().toISOString(),
            },
            { onConflict: "from_auction_event_id,to_auction_event_id,link_type" },
          );
        if (error) throw new Error(`auction_event_links upsert failed: ${error.message}`);
      }
      output.created.links = 1;
    }

    // 2) Repairs → timeline_events (one per line item)
    if (createRepairs) {
      // Prefer the stored description so we’re not re-scraping BaT here.
      const { data: meta } = await supabase
        .from("extraction_metadata")
        .select("field_value, created_at")
        .eq("vehicle_id", vehicleId)
        .eq("field_name", "raw_listing_description")
        .eq("source_url", listingUrlCanon)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      const description = meta?.field_value ? String(meta.field_value) : "";
      if (!description) {
        output.repairs_note = "No raw_listing_description found (run extract-bat-core first).";
      } else {
        const claims = extractRepairClaims(description);
        output.repairs_detected = claims.length;

        const eventDateYmd = windowBeforeYmd ?? new Date().toISOString().slice(0, 10);
        const workStartedIso = toIsoMidnightZ(windowAfterYmd);
        const workCompletedIso = toIsoMidnightZ(windowBeforeYmd);

        for (const c of claims) {
          const itemNorm = cleanRepairItem(c.item) ?? c.item;
          const dedupeKey = await sha256Hex(
            `bat:repair:${vehicleId}:${listingUrlCanon}:${itemNorm.toLowerCase()}`,
          );

          const { count: existsCount, error: existsErr } = await supabase
            .from("timeline_events")
            .select("id", { count: "exact", head: true })
            .eq("vehicle_id", vehicleId)
            .eq("event_type", "repair")
            .contains("metadata", { dedupe_key: dedupeKey });

          if (existsErr) throw new Error(`timeline_events exists check failed: ${existsErr.message}`);
          if ((existsCount || 0) > 0) {
            output.skipped.repairs_existing += 1;
            continue;
          }

          if (!dryRun) {
            const { error: insErr } = await supabase
              .from("timeline_events")
              .insert({
                vehicle_id: vehicleId,
                user_id: null,
                event_type: "repair",
                event_category: "maintenance",
                source_type: "system",
                source: "bat",
                title: `Repair: ${itemNorm}`,
                description: `Claimed in BaT listing description: ${itemNorm}`,
                event_date: eventDateYmd,
                confidence_score: 35,
                work_started: workStartedIso,
                work_completed: workCompletedIso,
                parts_mentioned: [itemNorm],
                metadata: {
                  dedupe_key: dedupeKey,
                  needs_receipt: true,
                  source_url: listingUrlCanon,
                  auction_event_id: currentEvent.id,
                  prior_auction_event_id: priorEvent?.id ?? null,
                  window_after: windowAfterYmd,
                  window_before: windowBeforeYmd,
                  extraction: {
                    version: "v2",
                    method: "regex",
                    evidence: c.evidence,
                  },
                },
              });
            if (insErr) throw new Error(`timeline_events insert failed: ${insErr.message}`);
          }

          output.created.repairs += 1;
        }
      }
    }

    return new Response(JSON.stringify(output), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

