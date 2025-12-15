import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizeVin(raw: string): string {
  return String(raw || "")
    .toUpperCase()
    .trim()
    .replace(/[^A-Z0-9]/g, "");
}

function isVinCharsetOk(v: string): boolean {
  // VINs exclude I/O/Q, but chassis numbers may be shorter; keep same restriction.
  return v.length >= 8 && v.length <= 17 && !/[IOQ]/.test(v);
}

function extractVinFromBatHtml(html: string): { vin: string | null; reason?: string } {
  const h = String(html || "");

  // Prefer "essentials" block when present (BaT layout)
  const essentialsStart = h.search(/<div[^>]*class="essentials"[^>]*>/i);
  let essentialsHTML = "";
  let essentialsText = "";
  if (essentialsStart !== -1) {
    let depth = 0;
    let pos = essentialsStart;
    let essentialsEnd = -1;
    while (pos < h.length) {
      const nextOpen = h.indexOf("<div", pos);
      const nextClose = h.indexOf("</div>", pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        pos = nextClose + 6;
        if (depth === 0) {
          essentialsEnd = nextClose;
          break;
        }
      }
    }
    if (essentialsEnd > essentialsStart) {
      essentialsHTML = h.substring(essentialsStart, essentialsEnd + 6);
      essentialsText = essentialsHTML.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    }
  }

  const patterns: RegExp[] = [
    /<li[^>]*>\s*VIN:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*VIN:\s*([A-HJ-NPR-Z0-9]{8,17})\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{8,17})<\/a>\s*<\/li>/i,
    /<li[^>]*>\s*Chassis:\s*([A-HJ-NPR-Z0-9]{8,17})\s*<\/li>/i,
    /(?:VIN|Chassis)\s*[:#]\s*([A-HJ-NPR-Z0-9]{8,17})/i,
    /"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{8,17})"/i,
  ];

  const tries = [
    { label: "essentialsHTML", text: essentialsHTML || "" },
    { label: "essentialsText", text: essentialsText || "" },
    { label: "fullHTML", text: h },
  ];

  for (const t of tries) {
    if (!t.text) continue;
    for (const p of patterns) {
      const m = t.text.match(p);
      if (m?.[1]) {
        const v = normalizeVin(m[1]);
        if (isVinCharsetOk(v)) return { vin: v, reason: `${t.label}:${p.source}` };
      }
    }
  }

  return { vin: null };
}

async function isAdmin(supabase: any, userId: string): Promise<boolean> {
  try {
    const { data } = await supabase
      .from("admin_users")
      .select("id")
      .eq("user_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    return Boolean(data?.id);
  } catch {
    return false;
  }
}

function isServiceRoleAuthHeader(authHeader: string, serviceKey: string): boolean {
  const a = String(authHeader || "").trim();
  const s = String(serviceKey || "").trim();
  if (!a || !s) return false;
  // Exact match is simplest + safe: only our infra knows the service role key.
  if (a === `Bearer ${s}`) return true;

  // Also support raw service key (rare) for function-to-function callers.
  if (a === s) return true;

  // Best-effort JWT role check (in case the service key differs but is still service_role).
  try {
    const parts = a.startsWith("Bearer ") ? a.slice(7).split(".") : a.split(".");
    if (parts.length !== 3) return false;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return String(payload?.role || "").toLowerCase() === "service_role";
  } catch {
    return false;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization") || req.headers.get("Authorization") || "";
    if (!authHeader) {
      return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY") ?? "";
    if (!supabaseUrl || !anonKey || !serviceKey) throw new Error("Missing Supabase env");

    // Admin client: DB writes + list queries
    const supabase = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    // Allow either:
    // - Admin user JWT (interactive)
    // - Service role JWT (cron / internal jobs)
    const isService = isServiceRoleAuthHeader(authHeader, serviceKey);
    let requesterId: string | null = null;

    if (!isService) {
      const supabaseAuth = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: userData, error: userErr } = await supabaseAuth.auth.getUser();
      if (userErr || !userData?.user?.id) {
        return new Response(JSON.stringify({ success: false, error: "Unauthorized" }), {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      requesterId = userData.user.id;
      if (!(await isAdmin(supabase, requesterId))) {
        return new Response(JSON.stringify({ success: false, error: "Forbidden" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const body = await req.json().catch(() => ({}));
    const max = Math.min(50, Math.max(1, Number(body?.max ?? 25)));
    const dryRun = body?.dry_run === true;

    const { data: rows, error } = await supabase
      .from("external_listings")
      .select("id, vehicle_id, listing_url, platform, listing_status, updated_at, vehicles!inner(id, vin, discovery_url, bat_auction_url, profile_origin)")
      .eq("platform", "bat")
      .not("listing_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(500);

    if (error) throw error;

    const candidates = (rows || [])
      .map((r: any) => ({
        external_listing_id: r.id,
        vehicle_id: r.vehicle_id,
        listing_url: r.listing_url,
        listing_status: r.listing_status,
        vehicle_vin: r.vehicles?.vin ?? null,
      }))
      .filter((r) => {
        const v = String(r.vehicle_vin || "").trim();
        return !v || v.startsWith("VIVA-");
      })
      .slice(0, max);

    let scanned = 0;
    let updated = 0;
    let found = 0;
    const results: any[] = [];

    for (const c of candidates) {
      scanned += 1;
      const url = String(c.listing_url || "").trim();
      if (!url) {
        results.push({ ...c, ok: false, error: "missing url" });
        continue;
      }

      try {
        const resp = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (compatible; N-Zero Bot/1.0)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.5",
          },
        });
        if (!resp.ok) {
          results.push({ ...c, ok: false, status: resp.status });
          continue;
        }
        const html = await resp.text();
        const extracted = extractVinFromBatHtml(html);
        if (!extracted.vin) {
          results.push({ ...c, ok: true, vin: null });
          continue;
        }

        found += 1;
        if (dryRun) {
          results.push({ ...c, ok: true, vin: extracted.vin, dry_run: true });
          continue;
        }

        // Double-check vehicle still missing VIN to avoid overwriting.
        const { data: vRow } = await supabase
          .from("vehicles")
          .select("id, vin")
          .eq("id", c.vehicle_id)
          .maybeSingle();

        const existingVin = String((vRow as any)?.vin || "").trim();
        if (existingVin && !existingVin.startsWith("VIVA-")) {
          results.push({ ...c, ok: true, vin: existingVin, skipped: "already has vin" });
          continue;
        }

        await supabase
          .from("vehicles")
          .update({
            vin: extracted.vin,
            vin_source: "BaT Essentials",
            vin_confidence: 80,
            updated_at: new Date().toISOString(),
          })
          .eq("id", c.vehicle_id);

        await supabase
          .from("vehicle_field_sources")
          .insert({
            vehicle_id: c.vehicle_id,
            field_name: "vin",
            field_value: extracted.vin,
            source_type: "bat_listing",
            source_url: url,
            confidence_score: 80,
            is_verified: false,
            extraction_method: "html_regex",
            raw_extracted_text: null,
            metadata: {
              external_listing_id: c.external_listing_id,
              listing_status: c.listing_status,
              extraction_reason: extracted.reason || null,
            },
            user_id: requesterId,
            updated_at: new Date().toISOString(),
          })
          .catch(() => null);

        updated += 1;
        results.push({ ...c, ok: true, vin: extracted.vin, updated: true });
      } catch (e: any) {
        results.push({ ...c, ok: false, error: String(e?.message || e) });
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        dry_run: dryRun,
        scanned,
        found,
        updated,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error: any) {
    return new Response(JSON.stringify({ success: false, error: String(error?.message || error) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});


