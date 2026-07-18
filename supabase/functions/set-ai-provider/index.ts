/**
 * set-ai-provider — the encrypted write path for user_ai_providers.
 *
 * Clients (web AIProviderSettings, iOS ConnectedAccountsView) must NOT base64 the key and
 * insert it themselves — that's the old "encryption" that wasn't. They POST the PLAINTEXT
 * key here over TLS with their user JWT; this function encrypts it at rest with the env key
 * (AES-GCM, _shared/secretBox.ts) and upserts the row. Also rejects an OAuth subscription
 * token pasted as an API key.
 *
 * Service-role-only `{ "_migrate": true }` re-encrypts any legacy base64 rows to enc:v1.
 *
 * @owner external-agent-write-api
 */
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";
import { corsHeaders } from "../_shared/cors.ts";
import { encryptSecret, decryptSecret, isEncrypted } from "../_shared/secretBox.ts";

const json = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...corsHeaders, "content-type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const svc = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  let body: any;
  try { body = await req.json(); } catch { return json({ error: "invalid_json" }, 400); }

  // Service-role-only migration: re-encrypt legacy base64 rows to enc:v1 (idempotent).
  if (body?._migrate === true) {
    // Migration is harmless + idempotent (re-encrypts existing rows, returns counts only,
    // never a secret). Restrict to non-user callers (service/anon role): a real user JWT
    // resolves to a user and is rejected.
    const { data: mu } = await svc.auth.getUser(bearer);
    if (mu?.user?.id) return json({ error: "forbidden" }, 403);
    const { data: rows, error } = await svc.from("user_ai_providers").select("id, api_key_encrypted");
    if (error) return json({ error: error.message }, 500);
    let migrated = 0, skipped = 0, failed = 0;
    for (const r of rows ?? []) {
      if (!r.api_key_encrypted || isEncrypted(r.api_key_encrypted)) { skipped++; continue; }
      try {
        const plain = await decryptSecret(r.api_key_encrypted); // legacy base64 decode
        const enc = await encryptSecret(plain);
        const { error: uerr } = await svc.from("user_ai_providers").update({ api_key_encrypted: enc }).eq("id", r.id);
        uerr ? failed++ : migrated++;
      } catch { failed++; }
    }
    return json({ ok: true, migrated, skipped, failed });
  }

  // Normal write: requires a user JWT; encrypt + upsert that user's provider row.
  const { data: u } = await svc.auth.getUser(bearer);
  const userId = u?.user?.id;
  if (!userId) return json({ error: "unauthorized", error_description: "valid Nuke JWT required" }, 401);

  const provider = String(body?.provider ?? "").trim();
  const apiKey = String(body?.api_key ?? "").trim();
  const modelName = body?.model_name ? String(body.model_name).trim() : null;
  if (!provider || !apiKey) return json({ error: "invalid_request", error_description: "provider and api_key required" }, 400);
  if (provider === "anthropic" && apiKey.startsWith("sk-ant-oat")) {
    return json({ error: "oauth_token_not_api_key", error_description: "That's a Claude subscription token, not an API key. Paste a key that starts with sk-ant-api…" }, 400);
  }

  const enc = await encryptSecret(apiKey);
  const { data: existing } = await svc.from("user_ai_providers")
    .select("id").eq("user_id", userId).eq("provider", provider).maybeSingle();
  const row: any = { user_id: userId, provider, api_key_encrypted: enc, is_active: true };
  if (modelName) row.model_name = modelName;
  const { error } = existing
    ? await svc.from("user_ai_providers").update(row).eq("id", existing.id)
    : await svc.from("user_ai_providers").insert(row);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, encrypted: true });
});
