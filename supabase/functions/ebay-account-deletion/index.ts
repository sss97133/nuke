/**
 * ebay-account-deletion: eBay Marketplace Account Deletion notification endpoint.
 *
 * eBay requires it before it issues production keys. Public by design (eBay cannot send a JWT); its only write is
 * its own deletion-request record, through record_ebay_deletion().
 *
 *   GET ?challenge_code=…  -> {"challengeResponse": sha256_hex(challengeCode + verificationToken + endpointUrl)}
 *   POST notification      -> checks X-EBAY-SIGNATURE when it can (ECDSA, key from the Notification API),
 *                             records the request, answers 200. A signature that is present, checkable and wrong -> 412.
 *
 * Secrets: EBAY_VERIFICATION_TOKEN (32-80 chars [A-Za-z0-9_-]); EBAY_CLIENT_ID / EBAY_CLIENT_SECRET only to fetch the
 * signing key. EBAY_DELETION_ENDPOINT overrides the endpoint URL used in the challenge hash (default: the public function URL).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { mustWrite } from "../_shared/writeResult.ts";
import { appToken, ebayApiBase } from "../_shared/ebayAuth.ts";
import { verifyEbaySignature } from "../_shared/ebaySignature.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });

export async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function endpointUrl(): string {
  return Deno.env.get("EBAY_DELETION_ENDPOINT") ||
    `${Deno.env.get("SUPABASE_URL")}/functions/v1/ebay-account-deletion`;
}

const pubKeyCache = new Map<string, { pem: string; at: number }>();
async function publicKeyPem(kid: string): Promise<string | null> {
  const hit = pubKeyCache.get(kid);
  if (hit && Date.now() - hit.at < 3_600_000) return hit.pem;
  const token = await appToken("https://api.ebay.com/oauth/api_scope");
  if (!token) return null;
  const r = await fetch(`${ebayApiBase()}/commerce/notification/v1/public_key/${encodeURIComponent(kid)}`, { // guardrail-allow: raw-fetch (eBay JSON API, bearer token)
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) return null;
  const pem = (await r.json())?.key;
  if (typeof pem !== "string") return null;
  pubKeyCache.set(kid, { pem, at: Date.now() });
  return pem;
}

export async function handle(req: Request): Promise<Response> {
  const token = Deno.env.get("EBAY_VERIFICATION_TOKEN");
  if (req.method === "GET") {
    const code = new URL(req.url).searchParams.get("challenge_code");
    if (!code) return json({ error: "challenge_code required" }, 400);
    if (!token) return json({ error: "EBAY_VERIFICATION_TOKEN not set" }, 503);
    return json({ challengeResponse: await sha256Hex(code + token + endpointUrl()) });
  }
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const raw = await req.text();
  let body: any;
  try { body = JSON.parse(raw); } catch { return json({ error: "invalid json" }, 400); }
  const n = body?.notification;
  const d = n?.data;
  if (body?.metadata?.topic !== "MARKETPLACE_ACCOUNT_DELETION" || !n?.notificationId || !(d?.username || d?.userId)) {
    return json({ error: "not a MARKETPLACE_ACCOUNT_DELETION notification" }, 400);
  }

  // Signature: refuse only a checkable-and-wrong one. Unverifiable (no app keys yet) is recorded as such.
  let signatureChecked = false;
  const sig = req.headers.get("x-ebay-signature");
  if (sig) {
    try {
      const v = await verifyEbaySignature(sig, raw, publicKeyPem);
      if (v === "invalid") return json({ error: "signature mismatch" }, 412);
      signatureChecked = v === "valid";
    } catch (e) {
      console.error("[ebay-account-deletion] signature check error", (e as Error).message);
    }
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, projectSecretKey()!);
  mustWrite("record_ebay_deletion", await supabase.rpc("record_ebay_deletion", {
    p_notification_id: String(n.notificationId),
    p_username: d.username ?? null,
    p_user_id: d.userId ?? null,
    p_event_date: n.eventDate ?? null,
    p_publish_date: n.publishDate ?? null,
    p_signature_checked: signatureChecked,
  }));
  return new Response(null, { status: 200 });
}

Deno.serve(async (req) => {
  try { return await handle(req); }
  catch (e) { console.error("[ebay-account-deletion]", (e as Error).message); return json({ error: "internal" }, 500); }
});
