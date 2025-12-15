import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? (Deno.env.get("SERVICE_ROLE_KEY") ?? "");

type ReqBody = {
  pack_slug: string;
  action_slug: string;
  title: string;
  url: string;
  tags?: string[];
  source_url?: string | null;
  attribution?: string | null;
  license?: string | null;
  duration_ms?: number;
  cooldown_ms?: number;
  is_active?: boolean;
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...corsHeaders } });
}

function safeSlug(s: string) {
  return String(s || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64);
}

function requireEnv() {
  if (!SUPABASE_URL) throw new Error("SUPABASE_URL not configured");
  if (!SUPABASE_ANON_KEY) throw new Error("SUPABASE_ANON_KEY not configured");
  if (!SUPABASE_SERVICE_ROLE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
}

function hostAllowed(host: string): boolean {
  const h = host.toLowerCase();
  // Keep this conservative; expand intentionally as you add verified sources.
  const allow = new Set([
    "upload.wikimedia.org",
    "commons.wikimedia.org",
    "openclipart.org",
    "static.openclipart.org",
  ]);
  return allow.has(h);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json(405, { ok: false, error: "Method Not Allowed" });

  try {
    requireEnv();

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json(401, { ok: false, error: "Unauthorized" });

    const authClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData?.user?.id) return json(401, { ok: false, error: "Unauthorized" });

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

    const { data: adminRow, error: adminErr } = await service
      .from("admin_users")
      .select("id")
      .eq("user_id", userData.user.id)
      .eq("is_active", true)
      .maybeSingle();
    if (adminErr) throw adminErr;
    if (!adminRow) return json(403, { ok: false, error: "Forbidden" });

    const body = (await req.json().catch(() => ({}))) as Partial<ReqBody>;

    const packSlug = safeSlug(String(body.pack_slug || ""));
    const actionSlug = safeSlug(String(body.action_slug || ""));
    const title = String(body.title || "").trim();
    const urlRaw = String(body.url || "").trim();
    const license = String(body.license || "").trim();

    if (!packSlug) return json(400, { ok: false, error: "Missing pack_slug" });
    if (!actionSlug) return json(400, { ok: false, error: "Missing action_slug" });
    if (!title) return json(400, { ok: false, error: "Missing title" });
    if (!urlRaw) return json(400, { ok: false, error: "Missing url" });
    if (!license) return json(400, { ok: false, error: "Missing license (required for URL imports)" });

    let u: URL;
    try {
      u = new URL(urlRaw);
    } catch {
      return json(400, { ok: false, error: "Invalid URL" });
    }
    if (u.protocol !== "https:") return json(400, { ok: false, error: "Only https URLs are allowed" });
    if (!hostAllowed(u.hostname)) return json(400, { ok: false, error: `Host not allowed: ${u.hostname}` });

    const res = await fetch(u.toString(), {
      method: "GET",
      headers: { "User-Agent": "nuke-meme-indexer/1.0" },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return json(400, { ok: false, error: `Fetch failed (${res.status})`, details: text.slice(0, 200) });
    }

    const contentType = String(res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!contentType.startsWith("image/")) return json(400, { ok: false, error: `Unsupported content-type: ${contentType}` });

    const sizeHeader = Number(res.headers.get("content-length") || "0");
    if (Number.isFinite(sizeHeader) && sizeHeader > 10 * 1024 * 1024) {
      return json(400, { ok: false, error: "File too large (max 10MB)" });
    }

    const buf = await res.arrayBuffer();
    if (buf.byteLength > 10 * 1024 * 1024) return json(400, { ok: false, error: "File too large (max 10MB)" });

    const ext = (() => {
      if (contentType === "image/png") return "png";
      if (contentType === "image/jpeg") return "jpg";
      if (contentType === "image/webp") return "webp";
      if (contentType === "image/gif") return "gif";
      return "png";
    })();

    const objectPath = `packs/${packSlug}/${actionSlug}.${ext}`;
    const blob = new Blob([buf], { type: contentType });

    const { data: uploadData, error: uploadErr } = await service.storage
      .from("meme-assets")
      .upload(objectPath, blob, { upsert: true, contentType, cacheControl: "3600" });
    if (uploadErr) throw uploadErr;

    const publicUrl = service.storage.from("meme-assets").getPublicUrl(uploadData.path).data.publicUrl;
    if (!publicUrl) throw new Error("Failed to build public URL");

    const { data: packRow, error: packErr } = await service
      .from("stream_action_packs")
      .select("id, slug")
      .eq("slug", packSlug)
      .maybeSingle();
    if (packErr) throw packErr;
    if (!packRow?.id) return json(400, { ok: false, error: `Pack not found: ${packSlug}` });

    const tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t || "").trim()).filter(Boolean).slice(0, 50) : [];

    const upsertRow: Record<string, unknown> = {
      pack_id: packRow.id,
      slug: actionSlug,
      title,
      kind: "image_popup",
      render_text: null,
      image_url: publicUrl,
      sound_key: null,
      duration_ms: Math.max(250, Math.min(10000, Number(body.duration_ms || 1800))),
      cooldown_ms: Math.max(0, Math.min(60000, Number(body.cooldown_ms || 2500))),
      is_active: body.is_active ?? true,
      source_url: body.source_url ? String(body.source_url) : u.toString(),
      attribution: body.attribution ? String(body.attribution) : null,
      license: license,
      tags,
      metadata: { imported_via: "url", fetched_from: u.toString(), fetched_at: new Date().toISOString() },
    };

    const { data: actionRow, error: actionErr } = await service
      .from("stream_actions")
      .upsert(upsertRow, { onConflict: "pack_id,slug" })
      .select("id, pack_id, slug, title, kind, image_url")
      .maybeSingle();
    if (actionErr) throw actionErr;

    return json(200, { ok: true, pack_slug: packSlug, action: actionRow, asset_url: publicUrl });
  } catch (e: any) {
    return json(500, { ok: false, error: String(e?.message || e) });
  }
});


