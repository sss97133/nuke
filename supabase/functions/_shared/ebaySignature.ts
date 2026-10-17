/**
 * ebaySignature: verify the X-EBAY-SIGNATURE header on an eBay notification.
 * The header is base64 JSON { alg, kid, signature, digest }; `signature` is a base64 DER ECDSA signature over the raw
 * request body, made with the key `kid` that the Notification API returns as PEM. WebCrypto wants raw r||s, so the DER is converted.
 */

export type SigResult = "valid" | "invalid" | "unverifiable";

export function derToRaw(der: Uint8Array, size: number): Uint8Array {
  if (der[0] !== 0x30) throw new Error("not a DER sequence");
  let i = 2 + (der[1] & 0x80 ? der[1] & 0x7f : 0);
  const out = new Uint8Array(size * 2);
  for (let part = 0; part < 2; part++) {
    if (der[i] !== 0x02) throw new Error("bad DER integer");
    let len = der[i + 1];
    let start = i + 2;
    while (len > size && der[start] === 0) { start++; len--; }
    if (len > size) throw new Error("integer too long");
    out.set(der.subarray(start, start + len), part * size + (size - len));
    i = start + len;
  }
  return out;
}

const pemToDer = (pem: string) =>
  Uint8Array.from(atob(pem.replace(/-----[A-Z ]+-----|\s/g, "")), (c) => c.charCodeAt(0));

const HASH: Record<string, string> = { SHA1: "SHA-1", "SHA-1": "SHA-1", SHA256: "SHA-256", "SHA-256": "SHA-256", SHA384: "SHA-384", SHA512: "SHA-512" };

export async function verifyEbaySignature(
  header: string, rawBody: string, getPem: (kid: string) => Promise<string | null>,
): Promise<SigResult> {
  const h = JSON.parse(atob(header));
  if (!h?.kid || !h?.signature) return "unverifiable";
  const pem = await getPem(String(h.kid));
  if (!pem) return "unverifiable";
  const hash = HASH[String(h.digest ?? "SHA1").toUpperCase()] ?? "SHA-1";
  const spki = pemToDer(pem);
  for (const [curve, size] of [["P-256", 32], ["P-384", 48], ["P-521", 66]] as const) {
    let key: CryptoKey;
    try { key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: curve }, false, ["verify"]); }
    catch { continue; }
    const sig = derToRaw(Uint8Array.from(atob(h.signature), (c) => c.charCodeAt(0)), size);
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash }, key, sig, new TextEncoder().encode(rawBody));
    return ok ? "valid" : "invalid";
  }
  return "unverifiable";
}
