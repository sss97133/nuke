/**
 * measure-landing-depth: HTTP wrapper for measureSource (see measure.ts). POST { source, sample?, dry_run? }.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { measureSource } from "./measure.ts";

Deno.serve(async (req) => {
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const sb = createClient(Deno.env.get("SUPABASE_URL") ?? "", projectSecretKey() ?? "", { auth: { persistSession: false } });
    const body = await req.json().catch(() => ({}));
    if (!body.source) return Response.json({ error: "source required" }, { status: 400, headers: corsHeaders });
    const r = await measureSource(sb, body);
    return Response.json({ ok: true, ...r, rows: body.dry_run ? r.rows : undefined, fields: r.rows.length }, { headers: corsHeaders });
  } catch (e) {
    return Response.json({ error: String((e as Error).message ?? e) }, { status: 500, headers: corsHeaders });
  }
});
