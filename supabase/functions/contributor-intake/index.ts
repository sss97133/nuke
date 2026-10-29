/**
 * contributor-intake — a contributor (a builder, previous owner, shop or appraiser with no Nuke account) answers the
 * owner's questions and sends documents through a single-use-per-contributor link, from their phone.
 * Routes, attestation fields and limits: core.ts. Writes go only through the sanctioned SECURITY DEFINER writers
 * contributor_intake_open / _answer / _file (service_role only); this function holds the service key.
 *
 * Env: SUPABASE_URL, the project secret key (supabaseKeys.ts), the publishable key (to resolve an owner's JWT), and
 * CONTRIBUTOR_IP_SALT (secret; daily-rotated salt for ip_sha256; unset means ip_sha256 is null).
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import exifr from "npm:exifr@7.1.3";
import { corsHeaders } from "../_shared/cors.ts";
import { requireWriteAuth } from "../_shared/writeGuard.ts";
import { projectPublishableKey, projectSecretKey } from "../_shared/supabaseKeys.ts";
import { defaultLimiter, handle, NOT_FOUND_BODY, TOKEN_RE, type JsonObject } from "./core.ts";

const headers = { ...corsHeaders, "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const service = createClient(SUPABASE_URL, projectSecretKey()!, { auth: { persistSession: false, autoRefreshToken: false } });
const limiter = defaultLimiter();

/** The anonymous exception: a request carrying a well-formed contributor token. The writers still validate it. */
async function carriesToken(req: Request): Promise<boolean> {
  try {
    const url = new URL(req.url);
    if (req.method === "GET") return TOKEN_RE.test(url.searchParams.get("token") ?? "");
    const c = req.clone();
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) return TOKEN_RE.test(String((await c.formData()).get("token") ?? ""));
    const b = await c.json();
    return TOKEN_RE.test(typeof b?.token === "string" ? b.token : "");
  } catch { return false; }
}

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  // Write guard: the service key, a signed-in owner (owner-recorded mode), or a contributor token. A refused caller
  // gets the same 404 an unknown token gets.
  const denied = await requireWriteAuth(req, { allowAnonymous: carriesToken, headers });
  if (denied) return json(NOT_FOUND_BODY, 404);
  try {
    const out = await handle(req, {
      rpc: async (name, args) => {
        const { data, error } = await service.rpc(name, args);
        return { data, error: error ? { code: error.code, message: error.message } : null };
      },
      upload: async (bucket, path, bytes, contentType) => {
        const { error } = await service.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
        return { error: error ? { message: error.message } : null };
      },
      exif: async (bytes) => {
        const parsed = await exifr.parse(bytes, { tiff: true, exif: true, gps: true, makerNote: false, userComment: false });
        return parsed ? JSON.parse(JSON.stringify(parsed)) as JsonObject : null;
      },
      resolveUser: async (jwt) => {
        const anon = createClient(SUPABASE_URL, projectPublishableKey()!, { auth: { persistSession: false, autoRefreshToken: false } });
        const { data } = await anon.auth.getUser(jwt);
        return data?.user?.id ?? null;
      },
      env: (n) => Deno.env.get(n),
      now: () => new Date(),
      limiter,
    });
    return json(out.body, out.status);
  } catch (err) {
    console.error("[contributor-intake]", err instanceof Error ? err.message : String(err));
    return json({ error: "internal" }, 500);
  }
});
