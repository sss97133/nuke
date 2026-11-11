/**
 * outbound.ts: the one gate every message to a person goes through.
 *
 * This file is the only code in supabase/functions allowed to reach Resend, Twilio, the WhatsApp Graph API, an
 * SMTP/Gmail send endpoint, or to read RESEND_API_KEY / TWILIO_AUTH_TOKEN. scripts/guardrails/check-outbound-gate.mjs
 * fails CI when any other file does. A function that wants to email or text someone calls sendOutbound().
 *
 * Mode, from one env var, OUTBOUND_MODE:
 *   off            nothing is sent, to anyone. A 'suppressed' row is kept in outbound_messages.
 *   internal_only  (the default, also when the var is unset or holds anything unrecognised) a message goes out only
 *                  when its recipient is on OUTBOUND_ALLOWLIST. Any other recipient gets no message: the gate writes
 *                  an outbound_messages row with status 'held' and returns { held: true }.
 *   live           every recipient is sent to. Setting this is the owner's decision, nobody else's.
 *
 * OUTBOUND_ALLOWLIST: comma-separated. An entry is an email address, a domain written "@example.com", or a phone
 * number (any format; compared as digits, a 10-digit number is read as +1). Unset or empty: nobody is allowed.
 *
 * A human approves one exact message by setting that outbound_messages row to status 'approved' (approved_by,
 * approved_at); releaseApproved(id) then sends the stored message as written, whatever the allowlist says. `off`
 * still blocks it.
 *
 * Fail closed: if a held row cannot be written, nothing is sent and the result says so.
 */

import { projectSecretKey } from "./supabaseKeys.ts";

export type OutboundMode = "off" | "internal_only" | "live";
export type OutboundChannel = "email" | "sms" | "whatsapp" | "imessage";
export type OutboundStatus = "sent" | "held" | "suppressed" | "failed";

export interface OutboundMessage {
  channel: OutboundChannel;
  /** Email address, or phone number (any format) for sms / whatsapp / imessage chat id. */
  to: string;
  /** Required for email. */
  subject?: string;
  /** Plain text body (sms / whatsapp / imessage; the text part of an email). */
  text?: string;
  /** Email HTML body. */
  html?: string;
  /** Email only. Default "Nuke <noreply@nuke.ag>". */
  from?: string;
  replyTo?: string;
  /** Email only: extra headers (In-Reply-To, References). */
  headers?: Record<string, string | undefined>;
  /** The edge function making the call; recorded on the outbox row. */
  caller: string;
  /** Free text recorded with the row (which event produced this). */
  context?: string;
}

export interface OutboundResult {
  status: OutboundStatus;
  /** True only when a provider accepted the message. */
  sent: boolean;
  held: boolean;
  mode: OutboundMode;
  /** The provider's message id (Resend id, Twilio sid). */
  id?: string;
  /** The outbound_messages row, when one was written. */
  outboxId?: string;
  reason?: string;
  error?: string;
}

export interface OutboxRow {
  id?: string;
  channel: OutboundChannel;
  recipient: string;
  subject: string | null;
  body: string | null;
  payload: Record<string, unknown>;
  status: "held" | "suppressed" | "sent" | "failed";
  reason: string;
  calling_function: string;
  mode: OutboundMode;
  content_sha256: string;
  provider_id?: string | null;
  sent_at?: string | null;
}

export interface OutboxStore {
  insert(row: OutboxRow): Promise<string | null>;
  /** The stored row, only while its status is 'approved'. */
  getApproved(id: string): Promise<(OutboxRow & { id: string }) | null>;
  markSent(id: string, providerId: string | null): Promise<void>;
  markFailed(id: string, error: string): Promise<void>;
  /** iMessage only: queue a pending row for the local bridge (imessage_outbound). */
  queueIMessage(chat: string, text: string, source: string): Promise<void>;
}

export interface OutboundDeps {
  env?: (name: string) => string | undefined;
  /** Used for the provider calls. */
  fetch?: typeof fetch;
  /** Used for the outbox. Default: PostgREST with the project secret key, through deps.fetch. */
  store?: OutboxStore;
}

const denoEnv = (name: string) => Deno.env.get(name);

const DEFAULT_FROM = "Nuke <noreply@nuke.ag>";

// ---------------------------------------------------------------------------
// Mode and allowlist
// ---------------------------------------------------------------------------

export function outboundMode(env: (n: string) => string | undefined = denoEnv): OutboundMode {
  const v = (env("OUTBOUND_MODE") ?? "").trim().toLowerCase();
  if (v === "off" || v === "live" || v === "internal_only") return v;
  return "internal_only";
}

function phoneDigits(raw: string): string {
  const d = raw.replace(/^whatsapp:/i, "").replace(/\D/g, "");
  return d.length === 10 ? `1${d}` : d;
}

/** "Name <a@b.c>" or "a@b.c" -> "a@b.c" lowercased. */
export function emailAddress(raw: string): string {
  const m = raw.match(/<([^>]+)>/);
  return (m ? m[1] : raw).trim().toLowerCase();
}

export function isAllowlisted(
  channel: OutboundChannel,
  to: string,
  env: (n: string) => string | undefined = denoEnv,
): boolean {
  const entries = (env("OUTBOUND_ALLOWLIST") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (entries.length === 0) return false;
  if (channel === "email") {
    const addr = emailAddress(to);
    if (!addr.includes("@")) return false;
    const domain = addr.slice(addr.lastIndexOf("@"));
    return entries.some((e) => e === addr || (e.startsWith("@") && e === domain));
  }
  const digits = phoneDigits(to);
  if (digits.length < 7) return false;
  return entries.some((e) => !e.includes("@") && phoneDigits(e) === digits);
}

// ---------------------------------------------------------------------------
// Outbox store (PostgREST)
// ---------------------------------------------------------------------------

export function postgrestStore(env: (n: string) => string | undefined, doFetch: typeof fetch): OutboxStore {
  const base = () => {
    const url = env("SUPABASE_URL");
    const key = projectSecretKey(env);
    if (!url || !key) throw new Error("SUPABASE_URL / secret key missing: cannot write outbound_messages");
    return {
      url: url.replace(/\/$/, ""),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    };
  };
  const rest = async (path: string, init: RequestInit) => {
    const { url, headers } = base();
    const res = await doFetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
    if (!res.ok) throw new Error(`outbound_messages ${init.method ?? "GET"} -> HTTP ${res.status}`);
    return res;
  };
  return {
    async insert(row) {
      const res = await rest("outbound_messages?select=id", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: JSON.stringify(row),
      });
      const rows = await res.json();
      return rows?.[0]?.id ?? null;
    },
    async getApproved(id) {
      const res = await rest(`outbound_messages?id=eq.${encodeURIComponent(id)}&status=eq.approved&select=*`, {
        method: "GET",
      });
      const rows = await res.json();
      return rows?.[0] ?? null;
    },
    async markSent(id, providerId) {
      await rest(`outbound_messages?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "sent", provider_id: providerId, sent_at: new Date().toISOString() }),
      });
    },
    async markFailed(id, error) {
      await rest(`outbound_messages?id=eq.${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "failed", reason: error.slice(0, 500) }),
      });
    },
    async queueIMessage(chat, text, source) {
      await rest("imessage_outbound", {
        method: "POST",
        body: JSON.stringify({ chat_identifier: chat, message: text, status: "pending", source }),
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Providers (the only place they are called)
// ---------------------------------------------------------------------------

interface ProviderOk {
  ok: true;
  id?: string;
}
interface ProviderErr {
  ok: false;
  error: string;
}

async function sendResend(msg: OutboundMessage, env: (n: string) => string | undefined, f: typeof fetch) {
  const key = env("RESEND_API_KEY");
  if (!key) return { ok: false, error: "Email service not configured" } as ProviderErr;
  const headers = msg.headers
    ? Object.fromEntries(Object.entries(msg.headers).filter(([, v]) => v !== undefined))
    : undefined;
  const res = await f("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: msg.from ?? DEFAULT_FROM,
      to: [msg.to],
      subject: msg.subject ?? "",
      html: msg.html,
      text: msg.text,
      reply_to: msg.replyTo,
      headers: headers && Object.keys(headers).length ? headers : undefined,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: data?.message || `Email send failed (HTTP ${res.status})` } as ProviderErr;
  return { ok: true, id: data?.id } as ProviderOk;
}

async function sendTwilio(msg: OutboundMessage, env: (n: string) => string | undefined, f: typeof fetch) {
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  const from = msg.channel === "whatsapp"
    ? (env("TWILIO_WHATSAPP_NUMBER") ?? env("TWILIO_PHONE_NUMBER"))
    : env("TWILIO_PHONE_NUMBER");
  if (!sid || !token || !from || sid.includes("your-")) return { ok: false, error: "Twilio not configured" } as ProviderErr;
  const e164 = `+${phoneDigits(msg.to)}`;
  const wa = msg.channel === "whatsapp";
  const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${sid}:${token}`),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      To: wa ? `whatsapp:${e164}` : e164,
      From: wa && !from.startsWith("whatsapp:") ? `whatsapp:${from}` : from,
      Body: msg.text ?? "",
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    return { ok: false, error: `Twilio ${res.status}: ${t.slice(0, 200)}` } as ProviderErr;
  }
  const data = await res.json().catch(() => ({}));
  return { ok: true, id: data?.sid } as ProviderOk;
}

// ---------------------------------------------------------------------------
// The gate
// ---------------------------------------------------------------------------

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function toRow(msg: OutboundMessage, status: OutboxRow["status"], reason: string, mode: OutboundMode, hash: string): OutboxRow {
  return {
    channel: msg.channel,
    recipient: msg.to,
    subject: msg.subject ?? null,
    body: msg.text ?? msg.html ?? null,
    payload: {
      from: msg.from, html: msg.html, text: msg.text, replyTo: msg.replyTo, headers: msg.headers,
      context: msg.context,
    },
    status,
    reason,
    calling_function: msg.caller,
    mode,
    content_sha256: hash,
  };
}

async function deliver(msg: OutboundMessage, env: (n: string) => string | undefined, f: typeof fetch, store: OutboxStore) {
  if (msg.channel === "email") return await sendResend(msg, env, f);
  if (msg.channel === "imessage") {
    await store.queueIMessage(msg.to, msg.text ?? "", msg.caller);
    return { ok: true } as ProviderOk;
  }
  return await sendTwilio(msg, env, f);
}

export async function sendOutbound(msg: OutboundMessage, deps: OutboundDeps = {}): Promise<OutboundResult> {
  const env = deps.env ?? denoEnv;
  const f = deps.fetch ?? fetch;
  const mode = outboundMode(env);
  const store = deps.store ?? postgrestStore(env, f);

  if (mode === "off" || !(mode === "live" || isAllowlisted(msg.channel, msg.to, env))) {
    const status = mode === "off" ? "suppressed" : "held";
    const reason = mode === "off"
      ? "OUTBOUND_MODE=off: nothing is sent"
      : "recipient not on OUTBOUND_ALLOWLIST (internal_only)";
    const hash = await sha256Hex(JSON.stringify([msg.channel, msg.to, msg.subject, msg.text, msg.html]));
    let outboxId: string | undefined;
    let error: string | undefined;
    try {
      outboxId = (await store.insert(toRow(msg, status, reason, mode, hash))) ?? undefined;
    } catch (e) {
      error = `outbox write failed, message not sent: ${String(e)}`;
      console.error(`[outbound] ${msg.caller}: ${error}`);
    }
    console.log(`[outbound] ${msg.caller}: ${status} ${msg.channel} (${reason})`);
    return { status, sent: false, held: status === "held", mode, outboxId, reason, error };
  }

  try {
    const r = await deliver(msg, env, f, store);
    if (!r.ok) return { status: "failed", sent: false, held: false, mode, error: r.error };
    return { status: "sent", sent: true, held: false, mode, id: r.id };
  } catch (e) {
    return { status: "failed", sent: false, held: false, mode, error: String(e) };
  }
}

/** Send a row a human approved, exactly as stored. Refused in `off`. */
export async function releaseApproved(id: string, deps: OutboundDeps = {}): Promise<OutboundResult> {
  const env = deps.env ?? denoEnv;
  const f = deps.fetch ?? fetch;
  const mode = outboundMode(env);
  const store = deps.store ?? postgrestStore(env, f);
  if (mode === "off") {
    return { status: "suppressed", sent: false, held: false, mode, reason: "OUTBOUND_MODE=off: nothing is sent" };
  }
  const row = await store.getApproved(id);
  if (!row) return { status: "failed", sent: false, held: false, mode, error: "no approved outbound_messages row with that id" };
  const p = (row.payload ?? {}) as Record<string, unknown>;
  const msg: OutboundMessage = {
    channel: row.channel,
    to: row.recipient,
    subject: row.subject ?? undefined,
    text: (p.text as string | undefined) ?? (row.channel === "email" ? undefined : row.body ?? undefined),
    html: p.html as string | undefined,
    from: p.from as string | undefined,
    replyTo: p.replyTo as string | undefined,
    headers: p.headers as Record<string, string> | undefined,
    caller: row.calling_function,
  };
  try {
    const r = await deliver(msg, env, f, store);
    if (!r.ok) {
      await store.markFailed(id, r.error);
      return { status: "failed", sent: false, held: false, mode, outboxId: id, error: r.error };
    }
    await store.markSent(id, r.id ?? null);
    return { status: "sent", sent: true, held: false, mode, id: r.id, outboxId: id };
  } catch (e) {
    return { status: "failed", sent: false, held: false, mode, outboxId: id, error: String(e) };
  }
}

// ---------------------------------------------------------------------------
// Read-only provider checks (no message is sent): vendor health and credentials
// ---------------------------------------------------------------------------

/** GET a Twilio account resource ("Balance.json" or ".json"), for balance monitoring. Sends no message. */
export async function twilioAccountRead(
  suffix: "Balance.json" | ".json",
  deps: Pick<OutboundDeps, "env" | "fetch"> = {},
): Promise<{ configured: boolean; status?: number; data?: Record<string, unknown> }> {
  const env = deps.env ?? denoEnv;
  const f = deps.fetch ?? fetch;
  const sid = env("TWILIO_ACCOUNT_SID");
  const token = env("TWILIO_AUTH_TOKEN");
  if (!sid || !token || sid.startsWith("your-")) return { configured: false };
  const path = suffix === ".json" ? `${sid}.json` : `${sid}/${suffix}`;
  const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${path}`, {
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`) },
  });
  const data = res.ok ? await res.json().catch(() => ({})) : undefined;
  return { configured: true, status: res.status, data };
}

/** Whether Resend's key is present and not a placeholder. Makes no call. */
export function resendConfigured(env: (n: string) => string | undefined = denoEnv): boolean {
  const key = env("RESEND_API_KEY");
  return !!key && !key.startsWith("your-") && !key.startsWith("re_placeholder");
}

/**
 * Check the Resend key by listing domains (read-only; no email is sent). Returns null when the key is not
 * configured; otherwise the HTTP status and Resend's error name, if any ("restricted_api_key" means a valid
 * send-only key).
 */
export async function resendAuthProbe(
  deps: Pick<OutboundDeps, "env" | "fetch"> = {},
): Promise<{ status: number; errorName?: string } | null> {
  const env = deps.env ?? denoEnv;
  const f = deps.fetch ?? fetch;
  if (!resendConfigured(env)) return null;
  const res = await f("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${env("RESEND_API_KEY")}` },
  });
  const data = res.ok ? undefined : await res.json().catch(() => ({}));
  return { status: res.status, errorName: data?.name };
}
