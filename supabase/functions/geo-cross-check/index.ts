// geo-cross-check — third-source location adjudication (the validator frame).
//
// Our system is a VALIDATOR, not a window onto one source. A stored coordinate
// is a claim; Apple Maps (MKLocalSearch) already gave a second opinion and 57
// pins CONFLICT (Apple >60m from ours). This organ brings in Google Places as
// the tie-breaker and returns a per-pin VERDICT:
//
//   apple_google_consensus — Apple & Google agree (≤80m of each other) and both
//        sit >100m from our stored point → OUR POINT IS STALE. We adopt the
//        consensus coordinate (Apple's, already stored), preserving the old one
//        in metadata.geocode.superseded, source='apple_google_consensus'.
//   ours_confirmed — Google lands closer to OUR point than to Apple → Apple was
//        the outlier. Clear the conflict, keep ours, record Apple was off.
//   survey — Google far (>150m) from BOTH → genuinely contested. Keep the
//        conflict flag; it stays a storefront-survey target.
//   unresolved — no Google result → keep the conflict, note we tried.
//
// No coordinate is moved unless TWO independent authorities corroborate it.
// Every change preserves the prior value (supersession, never deletion).
//
// POST { mode: 'conflicts' | 'nomatch', limit?: number, dry?: boolean }
// GOOGLE_PLACES_API_KEY is already a project secret.
//
// Caller: the service key only. A run spends Google lookups and writes organizations, and CI deploys this
// folder with the gateway's token check off, so the handler judges the caller itself, on every method.

import { createClient } from "jsr:@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { isServiceCaller, requireWriteAuth, writeAuthResponse } from "../_shared/writeGuard.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const PLACES_KEY = Deno.env.get("GOOGLE_PLACES_API_KEY");

// St Barth center + bias radius
const CENTER = { latitude: 17.9, longitude: -62.833 };

function haversine(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371000, toR = (d: number) => (d * Math.PI) / 180;
  const dLat = toR(bLat - aLat), dLon = toR(bLon - aLon);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toR(aLat)) * Math.cos(toR(bLat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)));
}

type Hit = { lat: number; lon: number; matched: string; addr: string; via: string };

// Whichever Google geo API this project has enabled. Try, in order: Places (New),
// legacy Places Text Search, then Geocoding. First that answers wins.
async function googlePlace(name: string): Promise<Hit | null> {
  const q = `${name} Saint Barthélemy`;

  // 1. Places API (New)
  try {
    const r = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": PLACES_KEY!,
        "X-Goog-FieldMask": "places.displayName,places.location,places.formattedAddress" },
      body: JSON.stringify({ textQuery: q,
        locationBias: { circle: { center: CENTER, radius: 15000.0 } },
        maxResultCount: 1, languageCode: "en" }),
    });
    if (r.ok) {
      const p = (await r.json()).places?.[0];
      if (p?.location) return { lat: p.location.latitude, lon: p.location.longitude,
        matched: p.displayName?.text ?? "", addr: p.formattedAddress ?? "", via: "places_new" };
      return null; // enabled, genuinely no result
    }
    if (r.status !== 403) throw new Error(`places_new ${r.status}: ${(await r.text()).slice(0, 120)}`);
  } catch (_) { /* fall through */ }

  // 2. Legacy Places Text Search
  {
    const u = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${encodeURIComponent(q)}&location=${CENTER.latitude},${CENTER.longitude}&radius=15000&key=${PLACES_KEY}`;
    const r = await fetch(u);
    const j = await r.json();
    if (j.status === "OK" && j.results?.[0]) {
      const p = j.results[0];
      return { lat: p.geometry.location.lat, lon: p.geometry.location.lng,
        matched: p.name ?? "", addr: p.formatted_address ?? "", via: "places_legacy" };
    }
    if (j.status === "ZERO_RESULTS") return null;
    if (j.status !== "REQUEST_DENIED") throw new Error(`places_legacy ${j.status}: ${(j.error_message ?? "").slice(0, 120)}`);
  }

  // 3. Geocoding API
  {
    const u = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&key=${PLACES_KEY}`;
    const r = await fetch(u);
    const j = await r.json();
    if (j.status === "OK" && j.results?.[0]) {
      const p = j.results[0];
      return { lat: p.geometry.location.lat, lon: p.geometry.location.lng,
        matched: name, addr: p.formatted_address ?? "", via: "geocoding" };
    }
    if (j.status === "ZERO_RESULTS") return null;
    throw new Error(`geocoding ${j.status}: ${(j.error_message ?? "").slice(0, 120)}`);
  }
}

Deno.serve(async (req) => {
  // The guard never judges OPTIONS, so a preflight is answered here and goes no further.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  const denied = await requireWriteAuth(req, { headers: corsHeaders });
  if (denied) return denied;
  if (!(await isServiceCaller(req))) {
    return writeAuthResponse({ status: 403, reason: "service key required" }, corsHeaders);
  }
  try {
    if (!PLACES_KEY) {
      return new Response(JSON.stringify({ configured: false, note: "GOOGLE_PLACES_API_KEY missing" }),
        { headers: { "Content-Type": "application/json" } });
    }
    const { mode = "conflicts", limit = 80, dry = false } = await req.json().catch(() => ({}));

    // Pull the target set with our stored coord + (for conflicts) Apple's coord.
    const { data: orgs, error } = await supabase
      .from("organizations")
      .select("id, name, latitude, longitude, metadata")
      .not("metadata->geocode", "is", null)
      .limit(2000);
    if (error) throw error;

    const targets = (orgs ?? []).filter((o) => {
      const g = (o.metadata as any)?.geocode;
      if (mode === "conflicts") return g?.conflict != null;
      if (mode === "nomatch") return g?.conflict == null && g?.corroborated == null;
      return false;
    }).slice(0, limit);

    const results: any[] = [];
    for (const o of targets) {
      const g = (o.metadata as any).geocode ?? {};
      const ourLat = o.latitude ?? g.lat, ourLon = o.longitude ?? g.lon;
      const appleLat = g.conflict?.apple_lat, appleLon = g.conflict?.apple_lon;
      let goog: Awaited<ReturnType<typeof googlePlace>> = null;
      try { goog = await googlePlace(o.name); }
      catch (e) { results.push({ name: o.name, verdict: "error", err: String((e as Error).message) }); continue; }

      if (!goog) { results.push({ id: o.id, name: o.name, verdict: "unresolved" }); continue; }

      const dOurs = (ourLat != null && ourLon != null) ? haversine(goog.lat, goog.lon, ourLat, ourLon) : null;
      const dApple = (appleLat != null && appleLon != null) ? haversine(goog.lat, goog.lon, appleLat, appleLon) : null;

      let verdict: string;
      if (mode === "nomatch") {
        // no Apple opinion here — Google either corroborates ours or flags drift
        verdict = (dOurs != null && dOurs <= 80) ? "google_corroborates" : (dOurs != null ? "google_drift" : "unresolved");
      } else if (dApple != null && dApple <= 80 && (dOurs == null || dOurs > 100)) {
        verdict = "apple_google_consensus"; // ours is stale
      } else if (dOurs != null && dApple != null && dOurs < dApple) {
        verdict = "ours_confirmed"; // Apple was the outlier
      } else if (dOurs != null && dOurs > 150 && dApple != null && dApple > 150) {
        verdict = "survey"; // Google agrees with nobody
      } else {
        verdict = "survey";
      }

      const rec = { name: o.name, verdict, google: { lat: goog.lat, lon: goog.lon, matched: goog.matched, addr: goog.addr },
        d_ours: dOurs, d_apple: dApple };
      results.push({ id: o.id, ...rec });

      if (dry) continue;

      // Write the adjudication back, provenance-preserving.
      const geo = { ...g };
      geo.google = { lat: goog.lat, lon: goog.lon, matched: goog.matched, via: goog.via,
        d_ours: dOurs, d_apple: dApple, verdict, checked_at: new Date().toISOString() };

      if (verdict === "apple_google_consensus" && appleLat != null) {
        geo.superseded = { lat: ourLat, lon: ourLon, source: g.source ?? null, reason: "apple_google_consensus", at: new Date().toISOString() };
        geo.source = "apple_google_consensus";
        geo.lat = appleLat; geo.lon = appleLon;
        delete geo.conflict; // resolved
        await supabase.from("organizations").update({
          latitude: appleLat, longitude: appleLon,
          metadata: { ...(o.metadata as any), geocode: geo },
        }).eq("id", o.id);
      } else if (verdict === "ours_confirmed" || verdict === "google_corroborates") {
        geo.corroborated = Array.from(new Set([...(g.corroborated ?? []), "google", ...(verdict === "ours_confirmed" ? ["apple_outlier_cleared"] : [])]));
        delete geo.conflict; // Apple was wrong / no conflict — clear it
        await supabase.from("organizations").update({
          metadata: { ...(o.metadata as any), geocode: geo },
        }).eq("id", o.id);
      } else {
        // survey / unresolved / google_drift — keep conflict, just record google opinion
        await supabase.from("organizations").update({
          metadata: { ...(o.metadata as any), geocode: geo },
        }).eq("id", o.id);
      }
    }

    const tally: Record<string, number> = {};
    for (const r of results) tally[r.verdict] = (tally[r.verdict] ?? 0) + 1;
    return new Response(JSON.stringify({ mode, checked: results.length, dry, tally, results }, null, 2),
      { headers: { "Content-Type": "application/json" } });
  } catch (e) {
    console.error("geo-cross-check:", e);
    return new Response(JSON.stringify({ error: String((e as Error)?.message ?? e) }), { status: 500 });
  }
});
