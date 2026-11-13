#!/usr/bin/env node
/**
 * GUARDRAIL: check-outbound-gate
 *
 * Nothing in supabase/functions may message a person except through supabase/functions/_shared/outbound.ts
 * (modes off / internal_only / live, recipient allowlist, held rows in outbound_messages). This fails when any
 * other file under supabase/functions references a provider send endpoint or reads a provider send credential:
 *
 *   api.resend.com, api.twilio.com, graph.facebook.com (messages), RESEND_API_KEY, TWILIO_AUTH_TOKEN,
 *   an SMTP client or host, the Gmail send endpoint, SendGrid / Postmark / Mailgun / nodemailer.
 *
 * Test files (*.test.ts, *_test.ts) and fixtures are exempt: they mock the provider, they never call it.
 * Comments are not exempt, so a doc comment cannot hide a reference; say "the mail provider" instead.
 *
 * Usage:  node scripts/guardrails/check-outbound-gate.mjs
 * Exit 1 with file:line for each violation.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const FN_DIR = path.join(REPO, "supabase/functions");
export const GATE = "_shared/outbound.ts";

export const PATTERNS = [
  { name: "Resend API", re: /api\.resend\.com/i },
  { name: "Twilio API", re: /api\.twilio\.com/i },
  { name: "Graph API messages", re: /graph\.facebook\.com[^\s'"`]*\/messages/i },
  { name: "Graph API (any)", re: /graph\.facebook\.com/i },
  { name: "Gmail send endpoint", re: /gmail\.googleapis\.com\/[^\s'"`]*\/messages\/send/i },
  { name: "Gmail send endpoint", re: /gmail\.googleapis\.com\/upload\/gmail\/v1\/users\/[^\s'"`]*\/messages\/send/i },
  { name: "SMTP", re: /\bsmtp(s)?:\/\/|\bsmtp\.[a-z0-9-]+\.[a-z]+|\bSmtpClient\b|\bnodemailer\b|denomailer/i },
  { name: "other mail API", re: /api\.sendgrid\.com|api\.postmarkapp\.com|api\.mailgun\.net|api\.mailchimp\.com|mandrillapp\.com/i },
  { name: "RESEND_API_KEY", re: /RESEND_API_KEY/ },
  { name: "TWILIO_AUTH_TOKEN", re: /TWILIO_AUTH_TOKEN/ },
];

const EXEMPT_FILE = /(\.test\.[cm]?[jt]sx?|_test\.[cm]?[jt]sx?)$/;

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "fixtures" || name === ".git") continue;
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) yield* walk(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(name) && !EXEMPT_FILE.test(name)) yield full;
  }
}

/** Violations in one source text. `rel` is the path under supabase/functions. */
export function scanText(rel, text) {
  if (rel === GATE) return [];
  const out = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    for (const { name, re } of PATTERNS) {
      if (re.test(lines[i])) out.push({ file: rel, line: i + 1, what: name, text: lines[i].trim().slice(0, 120) });
    }
  }
  return out;
}

export function scanTree(fnDir = FN_DIR) {
  const out = [];
  for (const file of walk(fnDir)) {
    const rel = path.relative(fnDir, file).split(path.sep).join("/");
    out.push(...scanText(rel, readFileSync(file, "utf8")));
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const v = scanTree();
  if (v.length) {
    console.error(`check-outbound-gate: ${v.length} reference(s) outside ${GATE}. Send through sendOutbound() instead.`);
    for (const x of v) console.error(`  supabase/functions/${x.file}:${x.line}  [${x.what}]  ${x.text}`);
    process.exit(1);
  }
  console.log(`check-outbound-gate: ok (only supabase/functions/${GATE} reaches a message provider)`);
}
