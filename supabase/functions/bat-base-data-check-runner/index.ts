import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

type ReqBody = {
  batch_size?: number;
  dry_run?: boolean;
  min_vehicle_age_hours?: number;
  vehicle_id?: string;
  requeue?: boolean;
  requeue_priority?: number;
  requeue_cooldown_hours?: number;
};

function safeNowIso(): string {
  return new Date().toISOString();
}

function isBatListingUrl(raw: string | null | undefined): boolean {
  const s = String(raw || "").toLowerCase();
  return s.includes("bringatrailer.com/listing/");
}

function coalesceUrl(v: any): string | null {
  const url = (v?.bat_auction_url || v?.listing_url || v?.discovery_url || null) as string | null;
  return url ? String(url) : null;
}

function parseFiniteMoney(value: any): number | null {
  const n = typeof value === "number" ? value : Number(String(value || "").replace(/[^0-9.]/g, ""));
  if (!Number.isFinite(n)) return null;
  if (n <= 0) return null;
  return n;
}

function parseDateMs(value: any): number | null {
  if (!value) return null;
  const t = new Date(String(value)).getTime();
  return Number.isFinite(t) ? t : null;
}

async function isAuthorized(
  req: Request,
): Promise<{ ok: boolean; mode: "service_role" | "admin_user" | "none"; error?: string }> {
  const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (!authHeader) return { ok: false, mode: "none", error: "Missing Authorization header" };

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && authHeader.trim() === `Bearer ${serviceKey}`) return { ok: true, mode: "service_role" };

  // Allow logged-in admins to trigger from the UI.
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? Deno.env.get("ANON_KEY") ?? "";
  if (!supabaseUrl || !anonKey) return { ok: false, mode: "none", error: "Server not configured" };

  try {
    const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user) return { ok: false, mode: "none", error: "Unauthorized" };

    // IMPORTANT: is_admin_or_moderator() depends on auth.uid(), so it must run under the user's JWT context.
    const { data: isAdmin, error: adminErr } = await authClient.rpc("is_admin_or_moderator");
    if (adminErr) return { ok: false, mode: "none", error: adminErr.message };
    if (isAdmin === true) return { ok: true, mode: "admin_user" };
    return { ok: false, mode: "none", error: "Forbidden" };
  } catch (e: any) {
    return { ok: false, mode: "none", error: e?.message || String(e) };
  }
}

type MissingResult = {
  missing_fields: string[];
  missing_score: number;
  reasons: Record<string, unknown>;
};

function computeBatBaseMissing(args: {
  vehicle: any;
  imageCount: number;
  commentCount: number;
}): MissingResult {
  const v = args.vehicle || {};
  const imageCount = Number(args.imageCount || 0);
  const commentCount = Number(args.commentCount || 0);

  const missing: string[] = [];
  let score = 0;

  const yearOk = typeof v.year === "number" && Number.isFinite(v.year) && v.year > 1885 && v.year < 2100;
  const makeOk = String(v.make || "").trim().length > 0;
  const modelOk = String(v.model || "").trim().length > 0;
  const titleOk = String(v.listing_title || v.bat_listing_title || "").trim().length > 0;
  const descLen = String(v.description || "").trim().length;
  const locationOk = String(v.listing_location || "").trim().length > 0;

  const vinOk = String(v.vin || "").trim().length >= 5;
  const mileageOk = typeof v.mileage === "number" && Number.isFinite(v.mileage) && v.mileage > 0;
  const colorOk = String(v.color || "").trim().length > 0;
  const interiorColorOk = String(v.interior_color || "").trim().length > 0;
  const transmissionOk = String(v.transmission || "").trim().length > 0;
  const drivetrainOk = String(v.drivetrain || "").trim().length > 0;
  const engineOk = String(v.engine_size || "").trim().length > 0;
  const bodyStyleOk = String(v.body_style || "").trim().length > 0;

  const reserveStatus = String(v.reserve_status || "").toLowerCase();
  const hasReserveStatus = reserveStatus.length > 0;
  const salePrice = parseFiniteMoney(v.sale_price);
  const highBid = parseFiniteMoney(v.high_bid);
  const auctionEndMs = parseDateMs(v.auction_end_date);
  const hasAuctionEnd = auctionEndMs !== null;
  const auctionEnded = auctionEndMs !== null ? auctionEndMs <= Date.now() : false;

  const descLower = String(v.description || "").toLowerCase();
  const mentionsNoReserve = descLower.includes("no reserve");
  const saysNoReserveButRNM = mentionsNoReserve && reserveStatus === "reserve_not_met";

  // Identity
  if (!yearOk) {
    missing.push("year");
    score += 2;
  }
  if (!makeOk) {
    missing.push("make");
    score += 2;
  }
  if (!modelOk) {
    missing.push("model");
    score += 2;
  }
  if (!titleOk) {
    missing.push("listing_title");
    score += 1;
  }

  // Content
  if (descLen < 80) {
    missing.push("description");
    score += 1;
  }
  if (!locationOk) {
    missing.push("listing_location");
    score += 1;
  }

  // Specs
  if (!vinOk) {
    missing.push("vin");
    score += 2;
  }
  if (!mileageOk) {
    missing.push("mileage");
    score += 1;
  }
  if (!colorOk) {
    missing.push("color");
    score += 1;
  }
  if (!interiorColorOk) {
    missing.push("interior_color");
    score += 1;
  }
  if (!transmissionOk) {
    missing.push("transmission");
    score += 1;
  }
  if (!drivetrainOk) {
    missing.push("drivetrain");
    score += 1;
  }
  if (!engineOk) {
    missing.push("engine_size");
    score += 1;
  }
  if (!bodyStyleOk) {
    missing.push("body_style");
    score += 1;
  }

  // Media / social proof (BaT should always have these)
  if (imageCount <= 0) {
    missing.push("images");
    score += 3;
  } else if (imageCount < 10) {
    missing.push("few_images");
    score += 1;
  }
  if (commentCount <= 0) {
    missing.push("comments");
    score += 1;
  }

  // Auction / outcome
  if (!hasAuctionEnd) {
    missing.push("auction_end_date");
    score += 1;
  }
  if (!hasReserveStatus) {
    missing.push("reserve_status");
    score += 1;
  }

  // If the auction has ended, require a high bid when bids exist.
  const bidCount = typeof v.bat_bids === "number" && Number.isFinite(v.bat_bids) ? v.bat_bids : null;
  const shouldHaveHighBid = auctionEnded && (bidCount === null || bidCount > 0);
  if (shouldHaveHighBid && !highBid) {
    missing.push("high_bid");
    score += 1;
  }

  // If no-reserve is implied, we should not be RNM, and a sold price should exist once ended.
  if (saysNoReserveButRNM) {
    missing.push("reserve_status_mismatch_no_reserve");
    score += 2;
  }
  const expectsSalePrice =
    auctionEnded && (reserveStatus === "no_reserve" || reserveStatus === "reserve_met" || saysNoReserveButRNM);
  if (expectsSalePrice && !salePrice) {
    missing.push("sale_price");
    score += 2;
  }

  return {
    missing_fields: Array.from(new Set(missing)),
    missing_score: score,
    reasons: {
      image_count: imageCount,
      comment_count: commentCount,
      description_len: descLen,
      mentions_no_reserve: mentionsNoReserve,
      reserve_status: reserveStatus || null,
      auction_end_date: v.auction_end_date || null,
      auction_ended: auctionEnded,
      bat_bids: bidCount,
      sale_price: salePrice,
      high_bid: highBid,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").trim();
  const serviceKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "").trim();
  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ success: false, error: "Server not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const auth = await isAuthorized(req);
  if (!auth.ok) {
    return new Response(JSON.stringify({ success: false, error: auth.error || "Unauthorized" }), {
      status: auth.error === "Forbidden" ? 403 : 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const body: ReqBody = await req.json().catch(() => ({}));
    const dryRun = body.dry_run === true;
    const requeue = body.requeue === false ? false : true;
    const batchSize = Math.max(1, Math.min(200, Number(body.batch_size || 50)));
    const minAgeHours = Math.max(0, Math.min(24 * 365, Number(body.min_vehicle_age_hours || 6)));
    const requeuePriority = Math.max(1, Math.min(1000, Number(body.requeue_priority || 250)));
    const cooldownHours = Math.max(0, Math.min(24 * 30, Number(body.requeue_cooldown_hours || 12)));
    const vehicleIdFilter = body.vehicle_id ? String(body.vehicle_id).trim() : null;

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const cutoffIso = new Date(Date.now() - minAgeHours * 60 * 60 * 1000).toISOString();

    let vehicles: any[] = [];
    if (vehicleIdFilter) {
      const { data, error } = await admin
        .from("vehicles")
        .select(
          "id,created_at,updated_at,listing_url,discovery_url,bat_auction_url,profile_origin,discovery_source,listing_source,listing_title,bat_listing_title,description,listing_location,vin,mileage,color,interior_color,transmission,drivetrain,engine_size,body_style,reserve_status,auction_end_date,sale_price,high_bid,bat_bids,origin_metadata",
        )
        .eq("id", vehicleIdFilter)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (data) vehicles = [data];
    } else {
      const { data, error } = await admin
        .from("vehicles")
        .select(
          "id,created_at,updated_at,listing_url,discovery_url,bat_auction_url,profile_origin,discovery_source,listing_source,listing_title,bat_listing_title,description,listing_location,vin,mileage,color,interior_color,transmission,drivetrain,engine_size,body_style,reserve_status,auction_end_date,sale_price,high_bid,bat_bids,origin_metadata",
        )
        .or(
          "listing_source.eq.bat,profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%",
        )
        .lte("updated_at", cutoffIso)
        .order("updated_at", { ascending: true })
        .limit(500);
      if (error) throw new Error(error.message);
      vehicles = Array.isArray(data) ? data : [];
    }

    const out: any = {
      success: true,
      auth_mode: auth.mode,
      dry_run: dryRun,
      requeue,
      requeue_priority: requeuePriority,
      requeue_cooldown_hours: cooldownHours,
      batch_size: batchSize,
      min_vehicle_age_hours: minAgeHours,
      scanned: vehicles.length,
      flagged: 0,
      cleared: 0,
      requeued: 0,
      skipped: 0,
      failed: 0,
      sample: [] as any[],
      note:
        "Computes a BaT 'base data' checklist, persists missing-field reasons in vehicles.origin_metadata.bat_base_check, and optionally re-queues BaT extraction even if the queue row is currently 'complete'.",
    };

    for (const v of vehicles) {
      if ((out.flagged + out.cleared) >= batchSize) break;

      const url = coalesceUrl(v);
      if (!url || !isBatListingUrl(url)) {
        out.skipped++;
        continue;
      }

      const om = v.origin_metadata && typeof v.origin_metadata === "object" ? v.origin_metadata : {};

      const [{ count: imageCount }, { count: commentCount }] = await Promise.all([
        admin.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", v.id),
        admin.from("auction_comments").select("id", { count: "exact", head: true }).eq("vehicle_id", v.id),
      ]);

      const missing = computeBatBaseMissing({
        vehicle: v,
        imageCount: Number(imageCount || 0),
        commentCount: Number(commentCount || 0),
      });

      const nowIso = safeNowIso();
      const prevBase = ((om as any)?.bat_base_check && typeof (om as any).bat_base_check === "object") ? (om as any).bat_base_check : {};
      const prevNeedsRepair = prevBase?.needs_repair === true;
      const lastEnqueuedMs = prevBase?.last_enqueued_at ? Date.parse(String(prevBase.last_enqueued_at)) : NaN;
      const cooldownActive = requeue && Number.isFinite(lastEnqueuedMs) && Date.now() - lastEnqueuedMs < cooldownHours * 60 * 60 * 1000;
      const needsRepair = missing.missing_fields.length > 0;

      // If the vehicle is now clean but previously flagged, clear the flag so UI stops showing the banner.
      if (!needsRepair) {
        if (prevNeedsRepair) {
          out.cleared++;
          if (dryRun) {
            if (out.sample.length < 25) out.sample.push({ vehicle_id: v.id, url, cleared: true, reasons: missing.reasons });
          } else {
            const nextOm = {
              ...(om as any),
              bat_base_check: {
                ...(prevBase as any),
                last_checked_at: nowIso,
                needs_repair: false,
                missing_fields: [],
                missing_score: 0,
                reasons: missing.reasons,
                resolved_at: nowIso,
              },
            };
            await admin.from("vehicles").update({ origin_metadata: nextOm, updated_at: nowIso }).eq("id", v.id).catch(() => null);
          }
        } else {
          out.skipped++;
        }
        continue;
      }

      out.flagged++;

      const canRequeue = requeue && !dryRun && !cooldownActive;
      const nextOm = {
        ...(om as any),
        bat_base_check: {
          ...(prevBase as any),
          last_checked_at: nowIso,
          needs_repair: true,
          missing_fields: missing.missing_fields,
          missing_score: missing.missing_score,
          reasons: missing.reasons,
          last_enqueued_at: canRequeue ? nowIso : (prevBase as any)?.last_enqueued_at || null,
        },
      };

      if (dryRun) {
        if (out.sample.length < 25) {
          out.sample.push({
            vehicle_id: v.id,
            url,
            missing_fields: missing.missing_fields,
            missing_score: missing.missing_score,
            reasons: missing.reasons,
            would_requeue: canRequeue,
            cooldown_active: cooldownActive,
          });
        }
        continue;
      }

      // Persist the flag on the vehicle (best-effort, but should generally succeed).
      await admin.from("vehicles").update({ origin_metadata: nextOm, updated_at: nowIso }).eq("id", v.id).catch(() => null);

      if (canRequeue) {
        try {
          const { data: existingQ, error: qSelErr } = await admin
            .from("bat_extraction_queue")
            .select("id, status, priority")
            .eq("vehicle_id", v.id)
            .maybeSingle();
          if (qSelErr) throw qSelErr;

          const existingStatus = String((existingQ as any)?.status || "");
          const isProcessing = existingStatus === "processing";
          const existingPriority = typeof (existingQ as any)?.priority === "number" ? Number((existingQ as any).priority) : 0;
          const nextPriority = Math.max(existingPriority, requeuePriority);

          if (!isProcessing) {
            // Ensure a queue row exists (insert if missing; update otherwise).
            if (!(existingQ as any)?.id) {
              const { error: insErr } = await admin.from("bat_extraction_queue").insert({
                vehicle_id: v.id,
                bat_url: url,
                priority: nextPriority,
                status: "pending",
                error_message: null,
                attempts: 0,
                next_attempt_at: null,
                locked_at: null,
                locked_by: null,
                completed_at: null,
                updated_at: nowIso,
              } as any);
              if (insErr) {
                // Best-effort: if we raced a concurrent insert, fall through to update.
                const code = String((insErr as any)?.code || "");
                if (code !== "23505") throw insErr;
              }
            }

            const { error: updErr } = await admin
              .from("bat_extraction_queue")
              .update({
                bat_url: url,
                priority: nextPriority,
                status: "pending",
                attempts: 0,
                error_message: null,
                next_attempt_at: null,
                locked_at: null,
                locked_by: null,
                completed_at: null,
                updated_at: nowIso,
              } as any)
              .eq("vehicle_id", v.id);
            if (updErr) throw updErr;

            out.requeued++;
          } else {
            out.skipped++;
          }
        } catch (e: any) {
          out.failed++;
          const msg = e?.message || String(e);
          if (out.sample.length < 25) out.sample.push({ vehicle_id: v.id, url, error: msg });
        }
      }
    }

    return new Response(JSON.stringify(out), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ success: false, error: e?.message || String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

