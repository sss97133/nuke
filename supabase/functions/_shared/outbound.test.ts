/**
 * The outbound gate: one env var picks the mode, a recipient off OUTBOUND_ALLOWLIST is held, `off` sends nothing,
 * and a missing env behaves as internal_only. Addresses and numbers here are placeholders (example.com, 555-01xx).
 */
import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  isAllowlisted,
  type OutboundDeps,
  type OutboxRow,
  type OutboxStore,
  outboundMode,
  releaseApproved,
  sendOutbound,
} from "./outbound.ts";

interface World {
  deps: OutboundDeps;
  providerCalls: { url: string; body: string }[];
  rows: OutboxRow[];
  imessages: { chat: string; text: string }[];
  approved: Map<string, OutboxRow & { id: string }>;
  sentIds: string[];
}

function world(env: Record<string, string>, opts: { storeFails?: boolean } = {}): World {
  const w: World = { deps: {}, providerCalls: [], rows: [], imessages: [], approved: new Map(), sentIds: [] };
  const store: OutboxStore = {
    insert: (row) => {
      if (opts.storeFails) return Promise.reject(new Error("db down"));
      w.rows.push(row);
      return Promise.resolve(`row_${w.rows.length}`);
    },
    getApproved: (id) => Promise.resolve(w.approved.get(id) ?? null),
    markSent: (id) => {
      w.sentIds.push(id);
      return Promise.resolve();
    },
    markFailed: () => Promise.resolve(),
    queueIMessage: (chat, text) => {
      w.imessages.push({ chat, text });
      return Promise.resolve();
    },
  };
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    w.providerCalls.push({ url, body: String(init?.body ?? "") });
    if (url.startsWith("https://api.resend.com/")) return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
    if (url.startsWith("https://api.twilio.com/")) return new Response(JSON.stringify({ sid: "SM1" }), { status: 201 });
    return new Response("", { status: 404 });
  }) as typeof fetch;
  w.deps = { env: (n) => env[n], fetch: f, store };
  return w;
}

const KEYS = {
  RESEND_API_KEY: "re_test",
  TWILIO_ACCOUNT_SID: "ACtest",
  TWILIO_AUTH_TOKEN: "tok",
  TWILIO_PHONE_NUMBER: "+15555550100",
  OUTBOUND_ALLOWLIST: "owner@example.com, @internal.example.com, +1 (555) 555-0123",
};

const mail = (to: string) => ({ channel: "email" as const, to, subject: "Hi", html: "<p>x</p>", caller: "test-fn" });
const text = (to: string) => ({ channel: "sms" as const, to, text: "hello", caller: "test-fn" });

Deno.test("allowlisted email recipient is sent", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const r = await sendOutbound(mail("Owner@Example.com"), w.deps);
  assertEquals(r.status, "sent");
  assertEquals(r.sent, true);
  assertEquals(w.providerCalls.length, 1);
  assertEquals(w.rows.length, 0);
});

Deno.test("allowlisted domain entry and 'Name <addr>' form are sent", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const r = await sendOutbound(mail("Someone <dev@internal.example.com>"), w.deps);
  assertEquals(r.sent, true);
});

Deno.test("allowlisted phone is sent, in any format", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const r = await sendOutbound(text("555-555-0123"), w.deps);
  assertEquals(r.sent, true);
  assert(w.providerCalls[0].url.startsWith("https://api.twilio.com/"));
  assert(w.providerCalls[0].body.includes("To=%2B15555550123"));
});

Deno.test("non-allowlisted email is held: no provider call, an outbox row with channel, to, subject, caller, reason", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const r = await sendOutbound(mail("stranger@elsewhere.example.org"), w.deps);
  assertEquals(r.status, "held");
  assertEquals(r.held, true);
  assertEquals(r.sent, false);
  assertEquals(w.providerCalls.length, 0);
  assertEquals(w.rows.length, 1);
  assertEquals(w.rows[0].status, "held");
  assertEquals(w.rows[0].channel, "email");
  assertEquals(w.rows[0].recipient, "stranger@elsewhere.example.org");
  assertEquals(w.rows[0].subject, "Hi");
  assertEquals(w.rows[0].calling_function, "test-fn");
  assert(w.rows[0].reason.includes("OUTBOUND_ALLOWLIST"));
  assertEquals(r.outboxId, "row_1");
});

Deno.test("non-allowlisted SMS and WhatsApp are held", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const a = await sendOutbound(text("+15555550199"), w.deps);
  const b = await sendOutbound({ ...text("+15555550199"), channel: "whatsapp" }, w.deps);
  assertEquals([a.status, b.status], ["held", "held"]);
  assertEquals(w.providerCalls.length, 0);
  assertEquals(w.rows.length, 2);
});

Deno.test("held iMessage is not queued for the bridge; allowlisted one is", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  const held = await sendOutbound({ ...text("+15555550199"), channel: "imessage" }, w.deps);
  assertEquals(held.held, true);
  assertEquals(w.imessages.length, 0);
  const ok = await sendOutbound({ ...text("+15555550123"), channel: "imessage" }, w.deps);
  assertEquals(ok.sent, true);
  assertEquals(w.imessages.length, 1);
});

Deno.test("off sends nothing, even to an allowlisted recipient", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "off" });
  const r = await sendOutbound(mail("owner@example.com"), w.deps);
  assertEquals(r.status, "suppressed");
  assertEquals(r.sent, false);
  assertEquals(r.mode, "off");
  assertEquals(w.providerCalls.length, 0);
  const s = await sendOutbound(text("+15555550123"), w.deps);
  assertEquals(s.sent, false);
  assertEquals(w.providerCalls.length, 0);
});

Deno.test("missing OUTBOUND_MODE behaves as internal_only", async () => {
  const w = world({ ...KEYS });
  assertEquals(outboundMode(w.deps.env), "internal_only");
  const held = await sendOutbound(mail("stranger@elsewhere.example.org"), w.deps);
  assertEquals(held.status, "held");
  const ok = await sendOutbound(mail("owner@example.com"), w.deps);
  assertEquals(ok.status, "sent");
  assertEquals(w.providerCalls.length, 1);
});

Deno.test("an unrecognised OUTBOUND_MODE value is internal_only, not live", async () => {
  for (const v of ["", "LIVE ", "true", "on", "1"]) {
    const m = outboundMode((n) => (n === "OUTBOUND_MODE" ? v : undefined));
    // only an exact (case/space-insensitive) 'live' opens the gate
    assertEquals(m, v.trim().toLowerCase() === "live" ? "live" : "internal_only", `value ${JSON.stringify(v)}`);
  }
});

Deno.test("missing allowlist means nobody is allowed (even with internal_only)", async () => {
  const { OUTBOUND_ALLOWLIST: _x, ...noList } = KEYS;
  const w = world(noList);
  const r = await sendOutbound(mail("owner@example.com"), w.deps);
  assertEquals(r.status, "held");
  assertEquals(w.providerCalls.length, 0);
});

Deno.test("live sends to anyone", async () => {
  const w = world({ ...KEYS, OUTBOUND_MODE: "live" });
  const r = await sendOutbound(mail("stranger@elsewhere.example.org"), w.deps);
  assertEquals(r.status, "sent");
  assertEquals(w.providerCalls.length, 1);
});

Deno.test("fail closed: when the held row cannot be written, still nothing is sent, and the result says so", async () => {
  const w = world({ ...KEYS }, { storeFails: true });
  const r = await sendOutbound(mail("stranger@elsewhere.example.org"), w.deps);
  assertEquals(r.sent, false);
  assertEquals(r.held, true);
  assert(r.error?.includes("not sent"));
  assertEquals(w.providerCalls.length, 0);
});

Deno.test("allowlisted but provider not configured: failed, not held, nothing sent", async () => {
  const w = world({ OUTBOUND_ALLOWLIST: "owner@example.com" });
  const r = await sendOutbound(mail("owner@example.com"), w.deps);
  assertEquals(r.status, "failed");
  assertEquals(r.error, "Email service not configured");
  assertEquals(w.providerCalls.length, 0);
});

Deno.test("isAllowlisted: lookalike domains and short numbers do not match", () => {
  const env = (n: string) => (n === "OUTBOUND_ALLOWLIST" ? "@internal.example.com,+15555550123" : undefined);
  assertEquals(isAllowlisted("email", "a@evilinternal.example.com", env), false);
  assertEquals(isAllowlisted("email", "a@internal.example.com.evil.org", env), false);
  assertEquals(isAllowlisted("email", "a@internal.example.com", env), true);
  assertEquals(isAllowlisted("sms", "0123", env), false);
});

Deno.test("a human-approved row is sent exactly as stored, whatever the allowlist; off still blocks it", async () => {
  const row = {
    id: "row_9", channel: "email" as const, recipient: "stranger@elsewhere.example.org", subject: "Approved subject",
    body: "<p>as written</p>", payload: { html: "<p>as written</p>", from: "Nuke <hello@example.com>" },
    status: "held" as const, reason: "x", calling_function: "test-fn", mode: "internal_only" as const, content_sha256: "h",
  };
  const w = world({ ...KEYS, OUTBOUND_MODE: "internal_only" });
  w.approved.set("row_9", row);
  const r = await releaseApproved("row_9", w.deps);
  assertEquals(r.sent, true);
  assertEquals(w.sentIds, ["row_9"]);
  const sent = JSON.parse(w.providerCalls[0].body);
  assertEquals(sent.to, ["stranger@elsewhere.example.org"]);
  assertEquals(sent.subject, "Approved subject");
  assertEquals(sent.html, "<p>as written</p>");

  const off = world({ ...KEYS, OUTBOUND_MODE: "off" });
  off.approved.set("row_9", row);
  const blocked = await releaseApproved("row_9", off.deps);
  assertEquals(blocked.sent, false);
  assertEquals(off.providerCalls.length, 0);

  const none = world({ ...KEYS });
  const missing = await releaseApproved("nope", none.deps);
  assertEquals(missing.sent, false);
  assertEquals(none.providerCalls.length, 0);
});
