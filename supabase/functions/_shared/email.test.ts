import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { sendEmail } from "./email.ts";
import type { OutboxRow, OutboxStore } from "./outbound.ts";

function setup(env: Record<string, string>) {
  const rows: OutboxRow[] = [];
  const calls: string[] = [];
  const store: OutboxStore = {
    insert: (r) => { rows.push(r); return Promise.resolve("r1"); },
    getApproved: () => Promise.resolve(null),
    markSent: () => Promise.resolve(),
    markFailed: () => Promise.resolve(),
    queueIMessage: () => Promise.resolve(),
  };
  const fetchFn = (async (u: RequestInfo | URL) => {
    calls.push(String(u));
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  }) as typeof fetch;
  return { rows, calls, deps: { env: (n: string) => env[n], fetch: fetchFn, store } };
}

Deno.test("sendEmail: default mode holds a stranger and reports held, not success", async () => {
  const s = setup({ RESEND_API_KEY: "re_test", OUTBOUND_ALLOWLIST: "owner@example.com" });
  const r = await sendEmail({ to: "stranger@elsewhere.example.org", subject: "s", html: "h", caller: "t" }, s.deps);
  assertEquals(r.success, false);
  assertEquals(r.held, true);
  assertEquals(s.calls.length, 0);
  assertEquals(s.rows.length, 1);
});

Deno.test("sendEmail: a list is split per recipient; the allowed one is sent, the other held", async () => {
  const s = setup({ RESEND_API_KEY: "re_test", OUTBOUND_ALLOWLIST: "owner@example.com" });
  const r = await sendEmail({ to: ["owner@example.com", "stranger@elsewhere.example.org"], subject: "s", html: "h", caller: "t" }, s.deps);
  assertEquals(s.calls.length, 1);
  assertEquals(s.rows.length, 1);
  assertEquals(s.rows[0].recipient, "stranger@elsewhere.example.org");
  assertEquals(r.held, true);
  assertEquals(r.success, false);
});

Deno.test("sendEmail: allowlisted recipient succeeds", async () => {
  const s = setup({ RESEND_API_KEY: "re_test", OUTBOUND_ALLOWLIST: "owner@example.com" });
  const r = await sendEmail({ to: "owner@example.com", subject: "s", html: "h", caller: "t" }, s.deps);
  assertEquals(r.success, true);
  assertEquals(r.id, "re_1");
});

Deno.test("sendEmail: empty recipient is an error and nothing is sent", async () => {
  const s = setup({ RESEND_API_KEY: "re_test", OUTBOUND_MODE: "live" });
  const r = await sendEmail({ to: "", subject: "s", html: "h", caller: "t" }, s.deps);
  assertEquals(r.success, false);
  assertEquals(s.calls.length, 0);
});
