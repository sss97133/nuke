// Pilot: read trim badges and GM SPID labels off classic GM truck photos, through the Gemini spend guard, and record each
// reading through ingest-observation as image_visible_badge_text / image_spid_rpo_codes. Reports cost and hit rate.
//
//   cd ~/nuke && dotenvx run -q -- deno run --allow-net --allow-env --allow-read --allow-write \
//     ~/.worktrees/<task>/scripts/image-badge-pilot.ts [--vehicles 50] [--no-write]
//
// Per vehicle: one low-detail triage call over up to 40 thumbnails picks the photos that show a SPID label or a legible
// badge; at most 4 of those get a detail read. A reading is a claim about one image, never about the build.
import { geminiFetch } from "../supabase/functions/_shared/geminiGuard.ts";

const args = Deno.args;
const option = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
// Published per-million-token rates (ai.google.dev/gemini-api/docs/pricing, read 2026-10-18); thinking tokens bill as output.
const PRICES: Record<string, { inputPerMTok: number; outputPerMTok: number }> = {
  "gemini-3.1-flash-lite": { inputPerMTok: 0.25, outputPerMTok: 1.50 },
};
const MODEL = option("model") ?? "gemini-3.1-flash-lite";
const PRICE = PRICES[MODEL] ?? null;
const vehicleTarget = Math.min(60, Number(option("vehicles") ?? 50));
const write = !args.includes("--no-write");

const base = Deno.env.get("SUPABASE_URL")!;
const key = Deno.env.get("SUPABASE_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const gkey = Deno.env.get("GEMINI_API_KEY") ?? Deno.env.get("GOOGLE_AI_API_KEY")!;
if (!base || !key || !gkey) throw new Error("SUPABASE_URL, a service key and a Gemini key are required");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

async function rest<T>(path: string): Promise<T> {
  const res = await fetch(`${base}/rest/v1/${path}`, { headers });
  if (!res.ok) throw new Error(`${path.split("?")[0]} ${res.status}: ${(await res.text()).slice(0, 160)}`);
  return await res.json();
}

type Vehicle = { id: string; year: number; make: string; model: string; listing_title: string | null; listing_url: string | null; discovery_url: string | null };
type Image = { id: string; thumbnail_url: string | null; medium_url: string | null; image_url: string | null; taken_at: string | null; created_at: string };

async function candidates(): Promise<Vehicle[]> {
  const picks: Vehicle[] = [];
  const plan: Array<[string, string, number]> = [["Chevrolet", "c10", 30], ["Chevrolet", "k10", 10], ["GMC", "sierra", 10]];
  for (const [make, model, want] of plan) {
    for (let year = 1973; year <= 1987 && picks.filter(p => p.make === make && p.model.toLowerCase().includes(model)).length < want; year++) {
      const rows = await rest<Vehicle[]>(`vehicles?select=id,year,make,model,listing_title,listing_url,discovery_url&make=eq.${make}&year=eq.${year}` +
        `&model=ilike.*${model}*&is_public=eq.true&deleted_at=is.null&listing_title=not.is.null&order=id.asc&limit=3`);
      picks.push(...rows.slice(0, 2));
    }
  }
  return picks.slice(0, vehicleTarget);
}

async function b64(url: string): Promise<{ data: string; mime: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    if (buf.length > 4_000_000) return null;
    let s = ""; for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { data: btoa(s), mime: res.headers.get("content-type")?.split(";")[0] || "image/jpeg" };
  } catch { return null; }
}

let calls = 0, inTok = 0, outTok = 0;
async function gemini(parts: unknown[], caller: string): Promise<any> {
  const res = await geminiFetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${gkey}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contents: [{ parts }], generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 1024 } }),
  }, caller);
  calls++;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`gemini ${res.status} ${JSON.stringify(body).slice(0, 200)}`);
  inTok += body.usageMetadata?.promptTokenCount ?? 0;
  outTok += (body.usageMetadata?.candidatesTokenCount ?? 0) + (body.usageMetadata?.thoughtsTokenCount ?? 0);
  const text = body.candidates?.[0]?.content?.parts?.find((p: any) => typeof p.text === "string")?.text ?? "{}";
  try { return JSON.parse(text); } catch { return {}; }
}

const TRIAGE = `These numbered photos are one listing of a classic GM truck. Return JSON {"spid":[indices],"badge":[indices]}.
"spid": photos that show a GM Service Parts Identification label (paper sticker with rows of three-character codes, usually in the glove box).
"badge": close-up photos where a trim or series badge, script or fender plate is legible (e.g. SILVERADO, CHEYENNE, SCOTTSDALE, SIERRA CLASSIC, CUSTOM DELUXE, BIG 10).
Only include a photo you are confident about. Empty lists are fine.`;
const DETAIL = `Transcribe only what is printed and legible in this photo. Return JSON {"spid_rpo_codes":[...],"badge_texts":[...]}.
spid_rpo_codes: every three-character code on a GM SPID label, exactly as printed, upper case; [] if there is no legible SPID label.
badge_texts: the words of each legible badge, script or plate, upper case as printed (e.g. "SILVERADO", "CHEYENNE SUPER 10"); [] if none.
Do not guess, complete or correct partially legible text.`;

async function claim(v: Vehicle, img: Image, property: "image_visible_badge_text" | "image_spid_rpo_codes", value: unknown) {
  const sourceUrl = [v.listing_url, v.discovery_url].find(u => typeof u === "string" && u.startsWith("https://")) ?? undefined;
  const structured: Record<string, unknown> = {
    image_id: img.id, [property]: value, model_name: MODEL, originality_status: "unknown", factory_configuration_status: "unknown",
    reading_role: property === "image_spid_rpo_codes" ? "spid_label_rpo_codes" : "visible_badge_text",
    ...(property === "image_spid_rpo_codes" ? { vin_match_status: "not_evaluated" } : {}),
    analysis_kind: "image_badge_spid_pilot_v1",
  };
  const res = await fetch(`${base}/functions/v1/ingest-observation`, { method: "POST", headers, body: JSON.stringify({
    source_slug: "photo_pipeline", kind: "specification", vehicle_id: v.id, property_key: property,
    observed_at: img.taken_at ?? img.created_at, source_url: sourceUrl,
    source_identifier: `image_badge_spid_pilot_v1:${img.id}:${property}:${JSON.stringify(value)}`,
    extraction_method: "image_badge_spid_reading_v1", agent_inferred: true, agent_model: MODEL, defer_analysis: true,
    content_text: `Model reading of one photo (${property === "image_spid_rpo_codes" ? "SPID label RPO codes" : "visible badge text"}): ${JSON.stringify(value)}. Originality and factory configuration are unknown.`,
    structured_data: structured,
  }) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const vehicles = await candidates();
const results: any[] = [];
for (const v of vehicles) {
  const row: any = { vehicle_id: v.id, title: v.listing_title, images: 0, triage: null, readings: [], claims: [], error: null };
  try {
    const images = await rest<Image[]>(`vehicle_images?select=id,thumbnail_url,medium_url,image_url,taken_at,created_at&vehicle_id=eq.${v.id}` +
      `&is_superseded=not.is.true&order=position.asc.nullslast,created_at.asc&limit=40`);
    const thumbs: Array<{ img: Image; data: { data: string; mime: string } }> = [];
    for (const img of images) {
      const url = img.thumbnail_url ?? img.medium_url ?? img.image_url; if (!url) continue;
      const data = await b64(url); if (data) thumbs.push({ img, data });
    }
    row.images = thumbs.length;
    if (thumbs.length === 0) { results.push(row); continue; }
    const parts: unknown[] = [{ text: TRIAGE }];
    thumbs.forEach((t, i) => parts.push({ text: `#${i}` }, { inline_data: { mime_type: t.data.mime, data: t.data.data } }));
    const triage = await gemini(parts, "image-badge-pilot:triage");
    const pick = (xs: unknown) => (Array.isArray(xs) ? xs : []).filter((i): i is number => Number.isInteger(i) && i >= 0 && i < thumbs.length);
    row.triage = { spid: pick(triage.spid), badge: pick(triage.badge) };
    const chosen = [...new Set([...row.triage.spid, ...row.triage.badge])].slice(0, 4);
    for (const i of chosen) {
      const img = thumbs[i].img;
      const full = await b64(img.medium_url ?? img.image_url ?? img.thumbnail_url!); if (!full) continue;
      const read = await gemini([{ text: DETAIL }, { inline_data: { mime_type: full.mime, data: full.data } }], "image-badge-pilot:detail");
      const codes = [...new Set((Array.isArray(read.spid_rpo_codes) ? read.spid_rpo_codes : []).filter((c: unknown) => typeof c === "string" && /^[A-Z0-9]{3}$/.test(c)))];
      const badges = (Array.isArray(read.badge_texts) ? read.badge_texts : []).filter((b: unknown) => typeof b === "string" && /^[A-Z0-9][A-Z0-9 .\/&'+-]{0,39}$/.test(b));
      row.readings.push({ image_id: img.id, codes, badges });
      if (!write) continue;
      if (codes.length >= 3) row.claims.push({ ...(await claim(v, img, "image_spid_rpo_codes", codes)), property: "spid" });
      for (const b of new Set(badges)) row.claims.push({ ...(await claim(v, img, "image_visible_badge_text", b)), property: "badge", value: b });
    }
  } catch (e) { row.error = String(e); if (String(e).includes("gemini_guard")) { results.push(row); break; } }
  results.push(row);
  console.log(v.year, v.model, `imgs=${row.images}`, `spid=${row.readings.filter((r: any) => r.codes.length >= 3).length}`, `badges=${row.readings.flatMap((r: any) => r.badges).join("/")}`, row.error ?? "");
}

const usd = PRICE ? inTok / 1e6 * PRICE.inputPerMTok + outTok / 1e6 * PRICE.outputPerMTok : NaN;
const withSpid = results.filter(r => r.readings.some((x: any) => x.codes.length >= 3)).length;
const withBadge = results.filter(r => r.readings.some((x: any) => x.badges.length > 0)).length;
const summary = { model: MODEL, vehicles: results.length, images_triaged: results.reduce((a, r) => a + r.images, 0), calls, input_tokens: inTok,
  output_tokens: outTok, usd_estimate: PRICE ? Number(usd.toFixed(4)) : "price unknown for this model",
  usd_per_vehicle: PRICE ? Number((usd / Math.max(1, results.length)).toFixed(4)) : null,
  vehicles_with_spid_reading: withSpid, vehicles_with_badge_reading: withBadge,
  claims_written: results.flatMap(r => r.claims).filter((c: any) => c.status === 200 && c.body?.success).length,
  claim_errors: results.flatMap(r => r.claims).filter((c: any) => c.status !== 200).length, errors: results.filter(r => r.error).length };
console.log(JSON.stringify(summary));
const dir = `${Deno.env.get("HOME")}/nuke-logs/image-badge-pilot`;
await Deno.mkdir(dir, { recursive: true });
const path = `${dir}/${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
await Deno.writeTextFile(path, JSON.stringify({ summary, results }, null, 2));
console.log("receipt", path);
