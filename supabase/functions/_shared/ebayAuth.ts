/**
 * ebayAuth: eBay application OAuth (client-credentials) for the Browse and Notification APIs.
 * Reads EBAY_CLIENT_ID / EBAY_CLIENT_SECRET from function secrets; never logs them. The token is cached in the
 * worker until shortly before it expires. EBAY_ENV=sandbox switches to the sandbox hosts.
 */

export const ebayApiBase = () => Deno.env.get("EBAY_ENV") === "sandbox" ? "https://api.sandbox.ebay.com" : "https://api.ebay.com";

const cache = new Map<string, { token: string; exp: number }>();

/** An application access token for `scope`, or null when the keys are not set or eBay refuses. */
export async function appToken(scope: string): Promise<string | null> {
  const id = Deno.env.get("EBAY_CLIENT_ID");
  const secret = Deno.env.get("EBAY_CLIENT_SECRET");
  if (!id || !secret) return null;
  const hit = cache.get(scope);
  if (hit && hit.exp > Date.now() + 60_000) return hit.token;
  const r = await fetch(`${ebayApiBase()}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${id}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "client_credentials", scope }),
  });
  if (!r.ok) {
    console.error(`[ebayAuth] token request failed: HTTP ${r.status}`);
    return null;
  }
  const j = await r.json();
  if (typeof j.access_token !== "string") return null;
  cache.set(scope, { token: j.access_token, exp: Date.now() + Number(j.expires_in ?? 7200) * 1000 });
  return j.access_token;
}
