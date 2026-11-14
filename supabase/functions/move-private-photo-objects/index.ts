// move-private-photo-objects: moves the stored files of private (is_sensitive) photos out of the public photo buckets
// into vehicle-photos-private, so a saved direct link stops loading, and moves them back when a photo is un-hidden.
// Queue and rules: supabase/migrations/20261113130000_private_photo_objects.sql. Service role only.
// POST { "limit": 50, "dry_run": true, "plan": true, "run": "<run id>" }
//   dry_run (default true): plan and report, move nothing.
// Every move is recorded on private_photo_objects (status, attempts, error, public_url_status); a file goes back by
// setting its row to restore_pending and running this function again.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { corsHeaders } from "../_shared/cors.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";

const PRIVATE_BUCKET = "vehicle-photos-private";

type Row = { id: number; image_id: string; source_bucket: string; source_key: string; private_key: string; status: string; attempts: number };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function callerKey(req: Request): string | null {
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7);
  return req.headers.get("apikey");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  const secret = projectSecretKey();
  if (!secret || callerKey(req) !== secret) return json({ error: "service role only" }, 401);

  const body = await req.json().catch(() => ({}));
  const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
  const dryRun = body.dry_run !== false;
  const plan = body.plan !== false;
  const run = typeof body.run === "string" && body.run ? body.run : `private-photo-move-${new Date().toISOString()}`;

  const url = Deno.env.get("SUPABASE_URL")!;
  const db = createClient(url, secret, { auth: { persistSession: false } });

  let planned: unknown = null;
  if (plan) {
    const { data, error } = await db.rpc("plan_private_photo_moves", { p_limit: limit, p_run: run });
    if (error) return json({ error: `plan: ${error.message}` }, 500);
    planned = data;
  }

  const { data: rows, error } = await db
    .from("private_photo_objects")
    .select("id,image_id,source_bucket,source_key,private_key,status,attempts")
    .in("status", ["pending", "restore_pending"])
    .lt("attempts", 5)
    .order("id")
    .limit(limit);
  if (error) return json({ error: `queue: ${error.message}` }, 500);

  if (dryRun) return json({ run, dry_run: true, planned, would_move: (rows ?? []).length, sample: (rows ?? []).slice(0, 10) });

  const results = { moved: 0, restored: 0, failed: 0, still_public: 0 };
  for (const r of (rows ?? []) as Row[]) {
    const toPrivate = r.status === "pending";
    const fromBucket = toPrivate ? r.source_bucket : PRIVATE_BUCKET;
    const fromKey = toPrivate ? r.source_key : r.private_key;
    const toBucket = toPrivate ? PRIVATE_BUCKET : r.source_bucket;
    const toKey = toPrivate ? r.private_key : r.source_key;
    const { error: moveError } = await db.storage.from(fromBucket).move(fromKey, toKey, { destinationBucket: toBucket });
    if (moveError) {
      results.failed++;
      await db.from("private_photo_objects").update({
        attempts: r.attempts + 1,
        error: moveError.message.slice(0, 300),
        status: r.attempts + 1 >= 5 ? "failed" : r.status,
        run,
      }).eq("id", r.id);
      continue;
    }
    // Proof: the public link no longer serves the file (or serves it again after a restore).
    let publicStatus: number | null = null;
    try {
      const head = await fetch(`${url}/storage/v1/object/public/${r.source_bucket}/${r.source_key}`, { method: "HEAD" });
      publicStatus = head.status;
    } catch (_) { /* recorded as null */ }
    if (toPrivate && publicStatus === 200) results.still_public++;
    const now = new Date().toISOString();
    await db.from("private_photo_objects").update(
      toPrivate
        ? { status: "moved", moved_at: now, error: null, public_url_status: publicStatus, run, attempts: r.attempts + 1 }
        : { status: "restored", restored_at: now, error: null, public_url_status: publicStatus, run, attempts: r.attempts + 1 },
    ).eq("id", r.id);
    if (toPrivate) results.moved++; else results.restored++;
  }
  return json({ run, dry_run: false, planned, ...results });
});
