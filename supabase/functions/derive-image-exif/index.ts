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
//
// Mode "complete" (20261122190000): rows that already have a clock but whose exif_data was never completed from the
// file. POST { user_id, mode: "complete", run_id, granted_by?, limit? (<= 50), dry_run? (default true) }.
// Reads camera make/model/software/lens and Apple's ContentIdentifier, BurstUUID and RunTime (camera.ts) and hands
// them to capture_exif_complete_v1, which adds only absent keys to exif_data, marks the row examined and never writes
// taken_at, a clock or GPS. A live run needs granted_by. Revert: capture_exif_complete_revert_v1(user, run_id).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectPublishableKey, projectSecretKey } from "../_shared/supabaseKeys.ts";
import { parseExif, exifDateToIso } from "./exif.ts";
import { completeFields, readCamera } from "./camera.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Authentication required" }, 401);

    const caller = createClient(
      Deno.env.get("SUPABASE_URL")!,
      projectPublishableKey()!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userData } = await caller.auth.getUser();

    const internal = req.headers.get("x-nuke-internal");
    const isServiceRole = roleOf(authHeader) === "service_role"
      || (!!internal && internal === projectSecretKey());

    const body = await req.json().catch(() => ({}));
    const userId = userData?.user?.id ?? (isServiceRole ? body.user_id : undefined);
    if (!userId) return json({ error: "Invalid session" }, 401);

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, projectSecretKey()!);
    if (body.mode === "complete") return json(await complete(admin, userId, body));
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

        const takenAt = exifDateToIso(exif.dateTimeOriginal, exif.offsetTimeOriginal);
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

// deno-lint-ignore no-explicit-any
async function complete(admin: any, userId: string, body: Record<string, unknown>) {
  const dryRun = body.dry_run !== false;
  const runId = String(body.run_id ?? "");
  const grantedBy = body.granted_by == null ? null : String(body.granted_by);
  if (!UUID_RE.test(runId)) return { error: "run_id (uuid) required" };
  if (!dryRun && !(grantedBy && UUID_RE.test(grantedBy))) return { error: "granted_by (uuid) required for a live run" };
  const limit = Math.min(Math.max(Number(body.limit) || 20, 1), 50);

  // Rows with a stored picture whose exif_data was never examined by this pass. capture_exif_complete_v1 re-checks
  // ownership, privacy and the marker; this is only the work list.
  let q = admin.from("vehicle_images")
    .select("id, image_url")
    .eq("user_id", userId)
    .not("image_url", "is", null)
    .neq("image_url", "")
    .is("exif_data->exif_completeness", null)
    .order("id")
    .limit(limit);
  if (body.image_id) q = q.eq("id", body.image_id);
  const { data: rows, error } = await q;
  if (error) throw error;

  const items: { image_id: string; fields: Record<string, unknown> }[] = [];
  const unread: { image_id: string; reason: string }[] = [];
  const containers: Record<string, number> = {};
  for (const r of rows ?? []) {
    try {
      const res = await fetch(r.image_url, { headers: { Range: "bytes=0-262143" } });
      if (!res.ok && res.status !== 206) { unread.push({ image_id: r.id, reason: `fetch ${res.status}` }); continue; }
      const cam = readCamera(new Uint8Array(await res.arrayBuffer()));
      const c = cam?.container ?? "none";
      containers[c] = (containers[c] ?? 0) + 1;
      // A file without readable camera fields is still examined (empty fields), so it is not fetched again.
      items.push({ image_id: r.id, fields: cam ? completeFields(cam) : {} });
    } catch (e) {
      unread.push({ image_id: r.id, reason: String(e instanceof Error ? e.message : e) });   // fetched again next time
    }
  }
  if (!items.length) return { mode: "complete", dry_run: dryRun, run_id: runId, selected: rows?.length ?? 0, unread, result: null };
  const { data: result, error: rpcErr } = await admin.rpc("capture_exif_complete_v1", {
    p_user: userId, p_run: runId, p_granted_by: grantedBy, p_items: items, p_dry: dryRun,
  });
  if (rpcErr) throw rpcErr;
  return { mode: "complete", dry_run: dryRun, run_id: runId, selected: rows?.length ?? 0, containers, unread, result,
           credential: "none (pure function)" };
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
