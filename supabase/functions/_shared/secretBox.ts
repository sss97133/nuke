/**
 * secretBox — AES-256-GCM encryption for secrets at rest (provider API keys, OAuth
 * bundles in user_ai_providers.api_key_encrypted).
 *
 * The key (AI_PROVIDER_ENC_KEY, base64 of 32 random bytes) lives in Supabase FUNCTION
 * SECRETS — the edge runtime env, NOT the database. So a DB dump / leaked service-role
 * key alone cannot decrypt these values; you also need the function env key. This is the
 * fix for the old base64 ("btoa") obfuscation that was not encryption.
 *
 * Format: "enc:v1:" + base64( iv(12 bytes) || ciphertext+gcmTag ).
 *
 * BACKWARD-COMPAT: decryptSecret() transparently reads BOTH new enc:v1 values and the
 * legacy plain-base64 values written by the old btoa path, so reads never break during
 * or after migration. New writes always use encryptSecret().
 *
 * @owner external-agent-write-api
 */

const ENC_PREFIX = "enc:v1:";

let cachedKey: CryptoKey | null = null;
async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const raw = Deno.env.get("AI_PROVIDER_ENC_KEY");
  if (!raw) throw new Error("AI_PROVIDER_ENC_KEY not set");
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (bytes.length !== 32) throw new Error(`AI_PROVIDER_ENC_KEY must be 32 bytes (got ${bytes.length})`);
  cachedKey = await crypto.subtle.importKey("raw", bytes, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
  return cachedKey;
}

/** Encrypt plaintext → "enc:v1:<base64(iv||ct)>". */
export async function encryptSecret(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await getKey(), new TextEncoder().encode(plain)),
  );
  const buf = new Uint8Array(iv.length + ct.length);
  buf.set(iv);
  buf.set(ct, iv.length);
  return ENC_PREFIX + btoa(String.fromCharCode(...buf));
}

/** Decrypt an enc:v1 value, OR transparently decode a legacy plain-base64 value. */
export async function decryptSecret(blob: string): Promise<string> {
  if (!blob.startsWith(ENC_PREFIX)) {
    // Legacy path: the old code stored btoa(rawKey) or btoa(JSON.stringify(bundle)).
    try { return atob(blob); } catch { return blob; }
  }
  const raw = Uint8Array.from(atob(blob.slice(ENC_PREFIX.length)), (c) => c.charCodeAt(0));
  const iv = raw.slice(0, 12);
  const ct = raw.slice(12);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await getKey(), ct);
  return new TextDecoder().decode(pt);
}

/** True if the stored value is already encrypted (vs legacy base64). */
export function isEncrypted(blob: string): boolean {
  return blob.startsWith(ENC_PREFIX);
}
