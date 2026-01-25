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
  // Modern VINs (17 char) exclude I/O/Q
  // Pre-1981 chassis numbers can be 6-17 chars and may be more permissive
  if (v.length === 17) {
    // Strict check for modern VINs
    return !/[IOQ]/.test(v);
  }
  // For chassis numbers (6-16 chars), just validate length and alphanumeric
  return v.length >= 6 && v.length <= 17 && /^[A-Z0-9]+$/.test(v);
}

// VIN patterns by manufacturer - covers 99% of vehicles on BaT
// Copied from bat-simple-extract for consistency
const VIN_PATTERNS = [
  /\b([1-5][A-HJ-NPR-Z0-9]{16})\b/g,       // US/Canada/Mexico (1-5)
  /\b(J[A-HJ-NPR-Z0-9]{16})\b/g,           // Japan
  /\b(K[A-HJ-NPR-Z0-9]{16})\b/g,           // Korea
  /\b(L[A-HJ-NPR-Z0-9]{16})\b/g,           // China
  /\b(S[A-HJ-NPR-Z0-9]{16})\b/g,           // UK
  /\b(W[A-HJ-NPR-Z0-9]{16})\b/g,           // Germany
  /\b(Y[A-HJ-NPR-Z0-9]{16})\b/g,           // Sweden/Belgium
  /\b(Z[A-HJ-NPR-Z0-9]{16})\b/g,           // Italy
  /\b(WP0[A-Z0-9]{14})\b/g,                // Porsche
  /\b(WDB[A-Z0-9]{14})\b/g,                // Mercedes
  /\b(WVW[A-Z0-9]{14})\b/g,                // VW
  /\b(WBA[A-Z0-9]{14})\b/g,                // BMW
  /\b(WAU[A-Z0-9]{14})\b/g,                // Audi
  /\b(ZFF[A-Z0-9]{14})\b/g,                // Ferrari
  /\b(ZAM[A-Z0-9]{14})\b/g,                // Maserati
  /\b(SCFZ[A-Z0-9]{13})\b/g,               // Aston Martin
  /\b(SAJ[A-Z0-9]{14})\b/g,                // Jaguar
  /\b(SAL[A-Z0-9]{14})\b/g,                // Land Rover
];

function extractVinFromBatHtml(html: string): { vin: string | null; reason?: string } {
  const h = String(html || "");

  // === PHASE 1: Try manufacturer-specific 17-char VIN patterns ===
  // This is the most reliable method - searches entire HTML for known VIN prefixes
  for (const pattern of VIN_PATTERNS) {
    const matches = h.match(pattern);
    if (matches && matches.length > 0) {
      // Return the most common VIN (in case of noise from comments, etc.)
      const counts: Record<string, number> = {};
      for (const m of matches) {
        counts[m] = (counts[m] || 0) + 1;
      }
      const bestVin = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
      const v = normalizeVin(bestVin);
      if (isVinCharsetOk(v)) {
        return { vin: v, reason: `manufacturer_pattern:${pattern.source}` };
      }
    }
  }

  // === PHASE 2: Try essentials section for Chassis/Serial (pre-1981 vehicles) ===
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

  // Chassis/Serial patterns for pre-1981 vehicles
  const chassisPatterns: Array<{ pattern: RegExp; label: string }> = [
    { pattern: /Chassis:\s*<a[^>]*>([A-Z0-9*-]+)<\/a>/i, label: "chassis_anchor" },
    { pattern: /Chassis:\s*([A-Z0-9*-]+)/i, label: "chassis_text" },
    { pattern: />Chassis<\/strong>:\s*([A-Z0-9*-]+)/i, label: "chassis_strong" },
    { pattern: /Serial(?:\s*Number)?:\s*<a[^>]*>([A-Z0-9*-]+)<\/a>/i, label: "serial_anchor" },
    { pattern: /Serial(?:\s*Number)?:\s*([A-Z0-9*-]+)/i, label: "serial_text" },
    { pattern: /<li[^>]*>\s*VIN:\s*<a[^>]*>([A-HJ-NPR-Z0-9]{6,17})<\/a>/i, label: "vin_li_anchor" },
    { pattern: /<li[^>]*>\s*VIN:\s*([A-HJ-NPR-Z0-9]{6,17})/i, label: "vin_li_text" },
    { pattern: /(?:VIN|Chassis)\s*[:#]\s*([A-Z0-9*-]{6,17})/i, label: "vin_chassis_label" },
    { pattern: /"vin"\s*:\s*"([A-HJ-NPR-Z0-9]{6,17})"/i, label: "json_vin" },
  ];

  // Try essentials HTML first, then essentials text, then full HTML
  const textSources = [
    { text: essentialsHTML, label: "essentialsHTML" },
    { text: essentialsText, label: "essentialsText" },
    { text: h, label: "fullHTML" },
  ];

  for (const source of textSources) {
    if (!source.text) continue;
    for (const { pattern, label } of chassisPatterns) {
      const m = source.text.match(pattern);
      if (m?.[1]) {
        const chassis = m[1].trim();
        // Validate: at least 6 chars, alphanumeric with optional * and -
        if (chassis.length >= 6 && /^[A-Z0-9*-]+$/i.test(chassis)) {
          const v = normalizeVin(chassis);
          if (v.length >= 6) {
            return { vin: v, reason: `${source.label}:${label}` };
          }
        }
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
    const offset = Math.max(0, Number(body?.offset ?? 0));
    const randomize = body?.randomize !== false; // Default to randomizing

    const { data: rows, error } = await supabase
      .from("external_listings")
      .select("id, vehicle_id, listing_url, platform, listing_status, updated_at, vehicles!inner(id, vin, discovery_url, bat_auction_url, profile_origin)")
      .eq("platform", "bat")
      .not("listing_url", "is", null)
      .order("updated_at", { ascending: false })
      .limit(2000); // Get more to have enough after filtering

    if (error) throw error;

    let allCandidates = (rows || [])
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
      });

    // Randomize to avoid always hitting the same vehicles that have no VIN
    if (randomize) {
      allCandidates = allCandidates.sort(() => Math.random() - 0.5);
    }

    const candidates = allCandidates.slice(offset, offset + max);

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

        // Insert field source record (ignore errors - this is optional)
        try {
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
            });
        } catch { /* ignore field source errors */ }

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


