// derive-image-exif — give every photograph back its clock.
//
// WHY THIS EXISTS
// The theory says a claim carries who said it, WHEN, and on what basis. A photograph
// is mechanical testimony: the camera says "this is what was in front of me, at this
// instant." Strip the instant and the photo stops being evidence and becomes decoration.
//
// 78 photographs of a 1970 Road Runner were uploaded in September 2025 with
// taken_at = null and exif_data = null. The EXIF was never stripped — the upload path
// simply never read it. exiftool on the stored bytes returns DateTimeOriginal
// 2020-07-02. Five years of misplacement, recoverable from the file the system
// already owns.
//
// This reader is a PURE FUNCTION over bytes. No model, no credential, no cost. That
// matters: it proves the derivation loop is not "call an LLM on a schedule" — it is
// "run whichever reader the registry names," and some readers are just arithmetic.
//
// It writes the camera's own claim onto the row (taken_at, exif_data) — the same
// fields every healthy source already populates (iphoto: 10,245/10,354;
// capture_relay_ios: 5,480/5,480). It does NOT invent a time. An image whose bytes
// carry no DateTimeOriginal is left null and reported, never backfilled from
// created_at, because upload time is a different fact than capture time and
// conflating them is how the Road Runner got lost in the first place.
//
// Contract (invoked by derive-dispatch):
//   POST { user_id, image_id?, limit?, dry_run? }  → { derived: [...], skipped: [...] }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await caller.auth.getUser();

    const internal = req.headers.get("x-nuke-internal");
    const isServiceRole = roleOf(authHeader) === "service_role"
      || (!!internal && internal === Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"));

    const body = await req.json().catch(() => ({}));
    const userId = userData?.user?.id ?? (isServiceRole ? body.user_id : undefined);
    if (!userId) return json({ error: "Invalid session" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const dryRun = body.dry_run === true;
    const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 100);

    // Only this owner's images, only ones missing a clock. Idempotent by construction:
    // once taken_at is set the row stops being selected.
    let q = admin.from("vehicle_images")
      .select("id, image_url, vehicle_id")
      .eq("user_id", userId)
      .is("taken_at", null)
      .limit(limit);
    if (body.image_id) q = q.eq("id", body.image_id);

    const { data: images, error } = await q;
    if (error) throw error;
    if (!images?.length) return json({ derived: [], skipped: [], note: "no undated images" });

    const derived: unknown[] = [];
    const skipped: unknown[] = [];

    for (const img of images) {
      if (!img.image_url) { skipped.push({ image_id: img.id, reason: "no url" }); continue; }
      try {
        // EXIF lives in the APP1 segment near the head of a JPEG. Range-request the
        // first 256 KB rather than pulling 3 MB of pixels we will never look at.
        const res = await fetch(img.image_url, { headers: { Range: "bytes=0-262143" } });
        if (!res.ok && res.status !== 206) { skipped.push({ image_id: img.id, reason: `fetch ${res.status}` }); continue; }
        const bytes = new Uint8Array(await res.arrayBuffer());

        const exif = parseExif(bytes);
        if (!exif?.dateTimeOriginal) {
          // Never fall back to created_at. Upload time is not capture time.
          skipped.push({ image_id: img.id, reason: "no DateTimeOriginal in bytes" });
          continue;
        }

        const takenAt = exifDateToIso(exif.dateTimeOriginal);
        if (!takenAt) { skipped.push({ image_id: img.id, reason: `unparseable date ${exif.dateTimeOriginal}` }); continue; }

        if (!dryRun) {
          const { error: upErr } = await admin.from("vehicle_images")
            .update({ taken_at: takenAt, exif_data: exif.raw })
            .eq("id", img.id);
          if (upErr) { skipped.push({ image_id: img.id, reason: upErr.message }); continue; }
        }

        derived.push({ image_id: img.id, vehicle_id: img.vehicle_id, taken_at: takenAt, make: exif.make ?? null, model: exif.model ?? null });
      } catch (e) {
        skipped.push({ image_id: img.id, reason: String(e instanceof Error ? e.message : e) });
      }
    }

    return json({ derived, skipped, dry_run: dryRun, credential: "none (pure function)" });
  } catch (e) {
    console.error("[derive-image-exif]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});

// ── Minimal EXIF reader ───────────────────────────────────────────────────────
// Walks JPEG markers to APP1, verifies the "Exif\0\0" header, then reads the TIFF
// IFD0, follows the ExifIFD pointer (0x8769), and pulls the three tags worth having.
// Deliberately small: this is arithmetic over bytes, not a library.

interface Exif { dateTimeOriginal?: string; make?: string; model?: string; raw: Record<string, unknown>; }

const TAG_MAKE = 0x010f, TAG_MODEL = 0x0110, TAG_EXIF_IFD = 0x8769;
const TAG_DATETIME_ORIGINAL = 0x9003, TAG_DATETIME_DIGITIZED = 0x9004, TAG_DATETIME = 0x0132;

function parseExif(b: Uint8Array): Exif | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null; // not a JPEG
  let p = 2;
  while (p + 4 < b.length) {
    if (b[p] !== 0xff) { p++; continue; }
    const marker = b[p + 1];
    if (marker === 0xda) break;                    // start of scan: pixels from here
    const len = (b[p + 2] << 8) | b[p + 3];
    if (marker === 0xe1) {                         // APP1
      const s = p + 4;
      if (b[s] === 0x45 && b[s + 1] === 0x78 && b[s + 2] === 0x69 && b[s + 3] === 0x66) {
        return readTiff(b, s + 6);                 // skip "Exif\0\0"
      }
    }
    p += 2 + len;
  }
  return null;
}

function readTiff(b: Uint8Array, base: number): Exif | null {
  if (base + 8 > b.length) return null;
  const le = b[base] === 0x49 && b[base + 1] === 0x49;   // "II" little-endian, "MM" big
  const u16 = (o: number) => le ? b[o] | (b[o + 1] << 8) : (b[o] << 8) | b[o + 1];
  const u32 = (o: number) => le
    ? (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0
    : ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

  if (u16(base + 2) !== 0x2a) return null;
  const out: Exif = { raw: {} };

  const readIfd = (off: number) => {
    const at = base + off;
    if (at + 2 > b.length) return;
    const n = u16(at);
    for (let i = 0; i < n; i++) {
      const e = at + 2 + i * 12;
      if (e + 12 > b.length) return;
      const tag = u16(e), type = u16(e + 2), count = u32(e + 4);
      const valOff = (type === 2 && count > 4) ? base + u32(e + 8) : e + 8;

      if (type === 2 && valOff + count <= b.length) {                 // ASCII
        const s = new TextDecoder().decode(b.subarray(valOff, valOff + count)).replace(/\0+$/, "").trim();
        if (tag === TAG_DATETIME_ORIGINAL) { out.dateTimeOriginal = s; out.raw.DateTimeOriginal = s; }
        else if (tag === TAG_DATETIME_DIGITIZED) out.raw.CreateDate = s;
        else if (tag === TAG_DATETIME && !out.dateTimeOriginal) out.raw.ModifyDate = s;
        else if (tag === TAG_MAKE) { out.make = s; out.raw.Make = s; }
        else if (tag === TAG_MODEL) { out.model = s; out.raw.Model = s; }
      } else if (tag === TAG_EXIF_IFD) {
        readIfd(u32(e + 8));                                          // recurse into ExifIFD
      }
    }
  };

  readIfd(u32(base + 4));
  // A photo with no DateTimeOriginal may still carry DateTimeDigitized. Prefer the
  // former; accept the latter rather than inventing one.
  if (!out.dateTimeOriginal && typeof out.raw.CreateDate === "string") out.dateTimeOriginal = out.raw.CreateDate as string;
  return out.dateTimeOriginal || out.make ? out : null;
}

/** EXIF dates are "YYYY:MM:DD HH:MM:SS", local to the camera, with no zone. Treat as UTC. */
function exifDateToIso(s: string): string | null {
  const m = s.match(/^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (!m) return null;
  const [, y, mo, d, h, mi, se] = m;
  if (y === "0000") return null;
  const iso = `${y}-${mo}-${d}T${h}:${mi}:${se}Z`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function roleOf(authHeader: string | null): string | null {
  try {
    const tok = (authHeader ?? "").replace(/^Bearer\s+/i, "");
    const p = tok.split(".")[1];
    if (!p) return null;
    const pad = p + "=".repeat((4 - (p.length % 4)) % 4);
    return JSON.parse(atob(pad.replace(/-/g, "+").replace(/_/g, "/")))?.role ?? null;
  } catch { return null; }
}

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
