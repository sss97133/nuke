import { assertEquals } from "jsr:@std/assert@1";
import { derToRaw, verifyEbaySignature } from "../_shared/ebaySignature.ts";
import { handle, sha256Hex } from "./index.ts";

Deno.test("challenge hash order is challengeCode + token + endpoint", async () => {
  Deno.env.set("EBAY_VERIFICATION_TOKEN", "t".repeat(40));
  Deno.env.set("EBAY_DELETION_ENDPOINT", "https://x.test/functions/v1/ebay-account-deletion");
  const res = await handle(new Request("https://x.test/functions/v1/ebay-account-deletion?challenge_code=abc"));
  assertEquals((await res.json()).challengeResponse,
    await sha256Hex("abc" + "t".repeat(40) + "https://x.test/functions/v1/ebay-account-deletion"));
});

Deno.test("a signature made with the key verifies, a tampered body does not", async () => {
  const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const body = '{"a":1}';
  const raw = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-1" }, kp.privateKey, new TextEncoder().encode(body)));
  const enc = (b: Uint8Array) => { const i = b[0] & 0x80 ? [0, ...b] : [...b]; return [0x02, i.length, ...i]; };
  const trim = (b: Uint8Array) => { let k = 0; while (k < b.length - 1 && b[k] === 0) k++; return b.slice(k); };
  const r = enc(trim(raw.slice(0, 32))), s = enc(trim(raw.slice(32)));
  const der = new Uint8Array([0x30, r.length + s.length, ...r, ...s]);
  assertEquals(derToRaw(der, 32), raw);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", kp.publicKey));
  const pem = `-----BEGIN PUBLIC KEY-----\n${btoa(String.fromCharCode(...spki))}\n-----END PUBLIC KEY-----`;
  const header = btoa(JSON.stringify({ alg: "ecdsa", kid: "k", digest: "SHA1", signature: btoa(String.fromCharCode(...der)) }));
  assertEquals(await verifyEbaySignature(header, body, async () => pem), "valid");
  assertEquals(await verifyEbaySignature(header, body + " ", async () => pem), "invalid");
  assertEquals(await verifyEbaySignature(header, body, async () => null), "unverifiable");
});
