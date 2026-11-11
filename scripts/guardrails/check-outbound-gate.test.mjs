import { test } from "node:test";
import assert from "node:assert/strict";
import { scanText, scanTree, GATE } from "./check-outbound-gate.mjs";

test("the gate itself may reference the providers", () => {
  assert.deepEqual(scanText(GATE, 'fetch("https://api.resend.com/emails"); env("RESEND_API_KEY")'), []);
});

test("any other file is flagged for each provider endpoint and credential", () => {
  const cases = [
    'fetch("https://api.resend.com/emails")',
    "https://api.twilio.com/2010-04-01/Accounts/x/Messages.json",
    "https://graph.facebook.com/v19.0/123/messages",
    "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
    "smtp://mail.example.com:587",
    "import nodemailer from 'nodemailer'",
    "https://api.sendgrid.com/v3/mail/send",
    'Deno.env.get("RESEND_API_KEY")',
    "const t = Deno.env.get('TWILIO_AUTH_TOKEN')",
  ];
  for (const c of cases) {
    assert.ok(scanText("some-fn/index.ts", c).length > 0, `not flagged: ${c}`);
  }
});

test("a function that calls the gate is clean", () => {
  const src = 'import { sendOutbound } from "../_shared/outbound.ts";\nawait sendOutbound({channel:"sms",to:"x",caller:"a"});';
  assert.deepEqual(scanText("some-fn/index.ts", src), []);
});

test("the live tree has no reference outside the gate", () => {
  assert.deepEqual(scanTree(), []);
});
