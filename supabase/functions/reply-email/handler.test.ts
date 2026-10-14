/**
 * reply-email handler tests — run with:
 *   deno test --node-modules-dir=none --allow-env --allow-net supabase/functions/reply-email/handler.test.ts
 * (--allow-net only so esm.sh imports resolve; every outbound call below is a stub that records it.)
 * Every key below is a disposable test string; every address is a synthetic example.
 *
 * Only the service key or an active admin may send, and the refusal comes before the body is read, the inbox
 * row is looked up or Resend is called (2026-10-14: before, any signed-in account could send).
 */

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { handleReplyEmail } from "./handler.ts";

const DEFAULT_KEY = "sb_secret_test_default_01";
const PUBLISHABLE_KEY = "sb_publishable_test_01";
const NOW = 1_800_000_000;
const ADMIN = "0b9f107a-0000-4000-8000-0000000000a1";
const MEMBER = "0b9f107a-0000-4000-8000-0000000000f9";
const INBOX_ID = "0b9f107a-0000-4000-8000-0000000000e1";

function b64url(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
const enc = (o: unknown) => b64url(new TextEncoder().encode(JSON.stringify(o)));

// The project's signing key (ES256), as for user sessions.
const signer = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const JWKS = JSON.stringify({ keys: [{ ...(await crypto.subtle.exportKey("jwk", signer.publicKey)), kid: "k1", alg: "ES256", use: "sig" }] });
async function es256(payload: Record<string, unknown>): Promise<string> {
  const input = `${enc({ alg: "ES256", typ: "JWT", kid: "k1" })}.${enc(payload)}`;
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, signer.privateKey, new TextEncoder().encode(input)));
  return `${input}.${b64url(sig)}`;
}

const env: Record<string, string> = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: DEFAULT_KEY }),
  SUPABASE_PUBLISHABLE_KEYS: JSON.stringify({ default: PUBLISHABLE_KEY }),
  SUPABASE_JWKS: JWKS,
  RESEND_API_KEY: "re_test_key_01",
};

interface Call { method: string; url: string; body: string | null }

/** Every outbound call goes through here: the admin lookup, the inbox read and update, Resend. */
function world(opts: { admins: string[]; adminLookupStatus?: number }, calls: Call[]): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method, url, body });
    if (url.includes("/rest/v1/admin_users")) {
      const id = new URL(url).searchParams.get("user_id")?.replace(/^eq\./, "");
      const rows = opts.admins.includes(id ?? "") ? [{ user_id: id }] : [];
      return new Response(JSON.stringify(rows), { status: opts.adminLookupStatus ?? 200 });
    }
    if (url.includes("/rest/v1/contact_inbox") && method === "GET") {
      return new Response(JSON.stringify({
        id: INBOX_ID, from_address: "sender@example.com", to_address: "investors@nuke.ag",
        subject: "Question", message_id: "<m1@example.com>",
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    if (url.includes("/rest/v1/contact_inbox") && method === "PATCH") {
      return new Response(null, { status: 204 });
    }
    if (url.startsWith("https://api.resend.com/")) {
      return new Response(JSON.stringify({ id: "re_sent_01" }), { status: 200 });
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

function reply(token: string): Request {
  return new Request("https://example.supabase.co/functions/v1/reply-email", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ inbox_id: INBOX_ID, reply_text: "Thanks for writing." }),
  });
}

const deps = (fetch: typeof globalThis.fetch) => ({ env: (n: string) => env[n], fetch, now: () => NOW });
const sentMail = (calls: Call[]) => calls.filter((c) => c.url.startsWith("https://api.resend.com/"));
const touchedInbox = (calls: Call[]) => calls.filter((c) => c.url.includes("/rest/v1/contact_inbox"));

Deno.test("a signed-in account that is not an admin → 403, before the inbox or Resend is touched", async () => {
  const calls: Call[] = [];
  const token = await es256({ role: "authenticated", sub: MEMBER, exp: NOW + 600 });
  const res = await handleReplyEmail(reply(token), deps(world({ admins: [ADMIN] }, calls)));
  assertEquals(res.status, 403);
  assertEquals((await res.json()).reason, "admins only");
  assertEquals(sentMail(calls).length, 0);
  assertEquals(touchedInbox(calls).length, 0);
});

Deno.test("an anonymous sign-in (role authenticated, is_anonymous) → 403, nothing sent", async () => {
  const calls: Call[] = [];
  const token = await es256({ role: "authenticated", sub: MEMBER, is_anonymous: true, exp: NOW + 600 });
  const res = await handleReplyEmail(reply(token), deps(world({ admins: [ADMIN] }, calls)));
  assertEquals(res.status, 403);
  assertEquals(sentMail(calls).length, 0);
});

Deno.test("an active admin → the reply goes to the original sender, from the address it came to, attributed", async () => {
  const calls: Call[] = [];
  const token = await es256({ role: "authenticated", sub: ADMIN, exp: NOW + 600 });
  const res = await handleReplyEmail(reply(token), deps(world({ admins: [ADMIN] }, calls)));
  assertEquals(res.status, 200);
  const mail = sentMail(calls);
  assertEquals(mail.length, 1);
  const sent = JSON.parse(mail[0].body!);
  assertEquals(sent.to, ["sender@example.com"]);
  assertEquals(sent.from, "Nuke Investor Relations <investors@nuke.ag>");
  const update = touchedInbox(calls).find((c) => c.method === "PATCH");
  assertEquals(JSON.parse(update!.body!).replied_by, ADMIN);
});

Deno.test("the service key → sends, with no admin lookup and no replier", async () => {
  const calls: Call[] = [];
  const res = await handleReplyEmail(reply(DEFAULT_KEY), deps(world({ admins: [] }, calls)));
  assertEquals(res.status, 200);
  assertEquals(calls.filter((c) => c.url.includes("/rest/v1/admin_users")).length, 0);
  assertEquals(sentMail(calls).length, 1);
  const update = touchedInbox(calls).find((c) => c.method === "PATCH");
  assertEquals(JSON.parse(update!.body!).replied_by, null);
});

Deno.test("the admin lookup fails → refused, nothing sent (fails closed)", async () => {
  const calls: Call[] = [];
  const token = await es256({ role: "authenticated", sub: ADMIN, exp: NOW + 600 });
  const res = await handleReplyEmail(reply(token), deps(world({ admins: [ADMIN], adminLookupStatus: 500 }, calls)));
  assertEquals(res.status, 403);
  assertEquals(sentMail(calls).length, 0);
});

Deno.test("the publishable key alone → 403, nothing sent", async () => {
  const calls: Call[] = [];
  const res = await handleReplyEmail(reply(PUBLISHABLE_KEY), deps(world({ admins: [ADMIN] }, calls)));
  assertEquals(res.status, 403);
  assertEquals(sentMail(calls).length, 0);
});
