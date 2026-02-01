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
  // optional: only process vehicles updated before this many hours ago (rate-limit repair churn)
  min_vehicle_age_hours?: number;
};

function isBatListingUrl(raw: string | null | undefined): boolean {
  const s = String(raw || "").toLowerCase();
  return s.includes("bringatrailer.com/listing/");
}

function coalesceUrl(v: any): string | null {
  const url = (v?.bat_auction_url || v?.listing_url || v?.discovery_url || null) as string | null;
  return url ? String(url) : null;
}

function safeNowIso(): string {
  return new Date().toISOString();
}

async function isAuthorized(req: Request): Promise<{ ok: boolean; mode: "service_role" | "admin_user" | "none"; error?: string }> {
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
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
    const batchSize = Math.max(1, Math.min(50, Number(body.batch_size || 10)));
    const dryRun = body.dry_run === true;
    const minAgeHours = Math.max(0, Math.min(24 * 90, Number(body.min_vehicle_age_hours || 6)));

    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Candidate pool: recent-ish BaT vehicles.
    // We'll filter down to "incomplete" based on cheap signals:
    // - 0 vehicle_images
    // - missing/short description
    // - missing listing_location
    // - 0 auction_comments
    const cutoffIso = new Date(Date.now() - minAgeHours * 60 * 60 * 1000).toISOString();
    const { data: vehicles, error: vErr } = await admin
      .from("vehicles")
      .select("id,created_at,updated_at,listing_url,discovery_url,bat_auction_url,profile_origin,discovery_source,description,listing_location,origin_metadata,sale_price,reserve_status,color,interior_color,body_style")
      .or(
        "profile_origin.eq.bat_import,discovery_source.eq.bat_import,listing_url.ilike.%bringatrailer.com/listing/%,discovery_url.ilike.%bringatrailer.com/listing/%,bat_auction_url.ilike.%bringatrailer.com/listing/%"
      )
      .lte("updated_at", cutoffIso)
      .order("updated_at", { ascending: true })
      .limit(300);
    if (vErr) throw new Error(vErr.message);

    const out: any = {
      success: true,
      auth_mode: auth.mode,
      dry_run: dryRun,
      batch_size: batchSize,
      min_vehicle_age_hours: minAgeHours,
      scanned: vehicles?.length || 0,
      candidates: 0,
      invoked: 0,
      skipped: 0,
      failed: 0,
      repaired: 0,
      sample: [] as any[],
      note:
        "Selects incomplete BaT vehicles (images/description/location/comments) and re-invokes the approved two-step workflow: extract-bat-core (core + HTML snapshot) then extract-auction-comments (comments/bids + HTML snapshot).",
    };

    for (const v of vehicles || []) {
      const url = coalesceUrl(v);
      if (!url || !isBatListingUrl(url)) {
        out.skipped++;
        continue;
      }

      // Rate-limit repeated repairs using origin_metadata.bat_repair.last_attempt_at
      const om = (v.origin_metadata && typeof v.origin_metadata === "object") ? v.origin_metadata : {};
      const lastAttempt = (om as any)?.bat_repair?.last_attempt_at ? Date.parse(String((om as any).bat_repair.last_attempt_at)) : NaN;
      if (Number.isFinite(lastAttempt) && Date.now() - lastAttempt < 6 * 60 * 60 * 1000) {
        out.skipped++;
        continue;
      }

      const descLen = String(v.description || "").trim().length;
      const hasLocation = String(v.listing_location || "").trim().length > 0;
      const descLower = String(v.description || "").toLowerCase();
      const mentionsNoReserve = descLower.includes("no reserve");
      const salePriceNum = Number((v as any)?.sale_price || 0);
      const hasSalePrice = Number.isFinite(salePriceNum) && salePriceNum > 0;
      const needsNoReserveSaleFix = mentionsNoReserve && !hasSalePrice;

      const hasColor = String((v as any)?.color || "").trim().length > 0;
      const hasInteriorColor = String((v as any)?.interior_color || "").trim().length > 0;
      const hasBodyStyle = String((v as any)?.body_style || "").trim().length > 0;

      const [{ count: imageCount }, { count: commentCount }] = await Promise.all([
        admin.from("vehicle_images").select("id", { count: "exact", head: true }).eq("vehicle_id", v.id),
        admin.from("auction_comments").select("id", { count: "exact", head: true }).eq("vehicle_id", v.id),
      ]);

      const needsRepair =
        (imageCount || 0) === 0 ||
        descLen < 80 ||
        !hasLocation ||
        (commentCount || 0) === 0 ||
        needsNoReserveSaleFix ||
        !hasColor ||
        !hasInteriorColor ||
        !hasBodyStyle;

      if (!needsRepair) {
        out.skipped++;
        continue;
      }

      out.candidates++;
      if (out.candidates > batchSize) break;

      if (dryRun) {
        out.invoked++;
        if (out.sample.length < 10) {
          out.sample.push({
            vehicle_id: v.id,
            url,
            would_invoke: true,
            reasons: {
              images: imageCount || 0,
              description_len: descLen,
              has_location: hasLocation,
              auction_comments: commentCount || 0,
              no_reserve_missing_sale_price: needsNoReserveSaleFix,
              has_color: hasColor,
              has_interior_color: hasInteriorColor,
              has_body_style: hasBodyStyle,
            },
          });
        }
        continue;
      }

      // Mark attempt in origin_metadata (best-effort)
      const nextOmAttempt = {
        ...(om as any),
        bat_repair: {
          ...((om as any)?.bat_repair || {}),
          last_attempt_at: safeNowIso(),
          attempts: Number((om as any)?.bat_repair?.attempts || 0) + 1,
          last_reasons: {
            images: imageCount || 0,
            description_len: descLen,
            has_location: hasLocation,
            auction_comments: commentCount || 0,
            no_reserve_missing_sale_price: needsNoReserveSaleFix,
            has_color: hasColor,
            has_interior_color: hasInteriorColor,
            has_body_style: hasBodyStyle,
          },
        },
      };
      await admin.from("vehicles").update({ origin_metadata: nextOmAttempt, updated_at: safeNowIso() }).eq("id", v.id).catch(() => null);

      try {
        // ✅ APPROVED WORKFLOW:
        // 1) extract-bat-core
        // 2) extract-auction-comments
        // See: docs/BAT_EXTRACTION_SUCCESS_WORKFLOW.md
        
        // Step 1: Extract core vehicle data (VIN, specs, images, auction_events)
        const step1Result = await admin.functions.invoke("extract-bat-core", {
          body: {
            url,
            max_vehicles: 1,
          },
        });
        
        if (step1Result.error) {
          throw new Error(`Step 1 failed: ${step1Result.error.message}`);
        }
        
        const vehicleId = step1Result.data?.created_vehicle_ids?.[0] || 
                         step1Result.data?.updated_vehicle_ids?.[0] || 
                         v.id;
        
        if (!vehicleId) {
          throw new Error("No vehicle_id returned from extract-bat-core");
        }
        
        // Step 2: Extract comments and bids (non-critical)
        try {
          await admin.functions.invoke("extract-auction-comments", {
            body: {
              auction_url: url,
              vehicle_id: vehicleId,
            },
          });
        } catch (commentError: any) {
          // Non-critical - log but don't fail
          console.warn(`Step 2 (comments) failed (non-critical): ${commentError?.message || String(commentError)}`);
        }
        
        out.invoked++;
        out.repaired++;

        // Save last_result for audit/debug
        const nextOmResult = {
          ...nextOmAttempt,
          bat_repair: {
            ...(nextOmAttempt as any).bat_repair,
            last_result_at: safeNowIso(),
            last_ok: true,
            last_error: null,
          },
        };
        await admin.from("vehicles").update({ origin_metadata: nextOmResult, updated_at: safeNowIso() }).eq("id", v.id).catch(() => null);

        if (out.sample.length < 10) out.sample.push({ 
          vehicle_id: v.id, 
          url, 
          invoked: true, 
          result: step1Result.data || null,
          workflow: 'approved-two-step',
        });
      } catch (e: any) {
        out.failed++;
        const nextOmResult = {
          ...nextOmAttempt,
          bat_repair: {
            ...(nextOmAttempt as any).bat_repair,
            last_result_at: safeNowIso(),
            last_ok: false,
            last_error: e?.message || String(e),
          },
        };
        await admin.from("vehicles").update({ origin_metadata: nextOmResult, updated_at: safeNowIso() }).eq("id", v.id).catch(() => null);
        if (out.sample.length < 10) out.sample.push({ vehicle_id: v.id, url, invoked: false, error: e?.message || String(e) });
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


