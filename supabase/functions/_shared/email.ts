/**
 * Shared Email Utility
 *
 * Transactional email, through the outbound gate (_shared/outbound.ts), which is the only code that calls
 * the mail provider. In internal_only mode (the default) a recipient not on OUTBOUND_ALLOWLIST is held, not sent:
 * the result has success:false and held:true.
 */

import { sendOutbound, type OutboundDeps } from "./outbound.ts";

export interface EmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  headers?: Record<string, string | undefined>;
  /** The calling edge function, recorded on the outbox row. */
  caller?: string;
}

export interface EmailResult {
  success: boolean;
  id?: string;
  error?: string;
  /** True when the gate kept the message back (recipient not allowed, or mode off). Nothing was sent. */
  held?: boolean;
  outboxId?: string;
}

export async function sendEmail(params: EmailParams, deps: OutboundDeps = {}): Promise<EmailResult> {
  const recipients = (Array.isArray(params.to) ? params.to : [params.to]).filter((t) => !!t);
  if (recipients.length === 0) return { success: false, error: "No recipient" };
  let held = false;
  let id: string | undefined;
  let outboxId: string | undefined;
  let error: string | undefined;
  let anySent = false;
  for (const to of recipients) {
    const r = await sendOutbound({
      channel: "email",
      to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      from: params.from,
      replyTo: params.replyTo,
      headers: params.headers,
      caller: params.caller ?? "unknown",
    }, deps);
    if (r.sent) { anySent = true; id = id ?? r.id; }
    if (r.status === "held" || r.status === "suppressed") { held = true; outboxId = outboxId ?? r.outboxId; }
    if (r.error) error = error ?? r.error;
    else if (!r.sent && r.reason) error = error ?? `held: ${r.reason}`;
  }
  return { success: anySent && !held && !error, id, error, held: held || undefined, outboxId };
}
