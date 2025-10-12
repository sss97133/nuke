// deno-lint-ignore-file no-explicit-any
// Supabase Edge Function: phone-verify
// Actions: send (SMS OTP), verify (confirm code)
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER

import { serve } from "https://deno.land/std@0.177.1/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TWILIO_SID = Deno.env.get("TWILIO_ACCOUNT_SID")!;
const TWILIO_TOKEN = Deno.env.get("TWILIO_AUTH_TOKEN")!;
const TWILIO_VERIFY_SERVICE_SID = Deno.env.get("TWILIO_VERIFY_SERVICE_SID")!; // e.g., VAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_KEY);

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function twilioVerifySend(to: string, channel: 'sms' | 'call' = 'sms') {
  const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/Verifications`;
  const params = new URLSearchParams();
  params.append("To", to);
  params.append("Channel", channel);
  const auth = "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const textErr = await res.text();
    throw new Error(`Twilio Verify send error ${res.status}: ${textErr}`);
  }
}

async function twilioVerifyCheck(to: string, code: string) {
  const url = `https://verify.twilio.com/v2/Services/${TWILIO_VERIFY_SERVICE_SID}/VerificationCheck`;
  const params = new URLSearchParams();
  params.append("To", to);
  params.append("Code", code);
  const auth = "Basic " + btoa(`${TWILIO_SID}:${TWILIO_TOKEN}`);
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
    body: params,
  });
  if (!res.ok) {
    const textErr = await res.text();
    throw new Error(`Twilio Verify check error ${res.status}: ${textErr}`);
  }
  const json = await res.json();
  if (json.status !== 'approved') {
    throw new Error('Invalid or expired code');
  }
}

serve(async (req) => {
  try {
    if (req.method === "OPTIONS") {
      return new Response("ok", { headers: corsHeaders });
    }
    if (req.method !== "POST") return json({ error: "Method Not Allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const action = body?.action as string;

    switch (action) {
      case "send": {
        const phone = (body?.phone as string)?.trim();
        const channel = ((body?.channel as string)?.trim()?.toLowerCase() === 'call') ? 'call' : 'sms';
        if (!phone) return json({ error: "Missing phone" }, 400);

        // Log verification attempt (pending)
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
        let logWarning: string | undefined;
        try {
          await supabaseAdmin.from("user_verifications").insert({
            user_id: user.id,
            verification_type: "phone",
            phone_number: phone,
            expires_at: expiresAt,
            ip_address: req.headers.get("x-forwarded-for") || undefined,
            user_agent: req.headers.get("user-agent") || undefined,
            status: "pending",
          } as any);
        } catch (e: any) {
          logWarning = `user_verifications insert skipped: ${e?.message || e}`;
        }

        // Update profile with phone and reset verification flags
        try {
          await supabaseAdmin
            .from("profiles")
            .update({
              phone_number: phone,
              phone_verified: false,
            } as any)
            .eq("id", user.id);
        } catch (e: any) {
          logWarning = `profiles update (send) skipped: ${e?.message || e}`;
        }

        // Trigger Twilio Verify
        try {
          await twilioVerifySend(phone, channel as 'sms' | 'call');
          return json({ ok: true, channel, warning: logWarning });
        } catch (e: any) {
          // If SMS failed and no explicit channel requested, try voice fallback
          const msg = e?.message || String(e);
          if (channel === 'sms') {
            try {
              await twilioVerifySend(phone, 'call');
              return json({ ok: true, channel: 'call', note: 'SMS failed, used voice call fallback', error: msg, warning: logWarning });
            } catch (e2: any) {
              return json({ ok: false, error: e2?.message || String(e2), prior_error: msg }, 200);
            }
          }
          return json({ ok: false, error: msg }, 200);
        }
      }

      case "verify": {
        const code = (body?.code as string)?.trim();
        const phone = (body?.phone as string)?.trim();
        if (!code) return json({ error: "Missing code" }, 400);
        if (!phone) return json({ error: "Missing phone" }, 400);

        // Verify via Twilio Verify API
        try {
          await twilioVerifyCheck(phone, code);
        } catch (e: any) {
          return json({ ok: false, error: e?.message || String(e) }, 200);
        }

        // Mark verified
        try {
          await supabaseAdmin
            .from("profiles")
            .update({
              phone_verified: true,
            } as any)
            .eq("id", user.id);
        } catch (e: any) {
          // non-fatal
        }

        try {
          await supabaseAdmin
            .from("user_verifications")
            .update({ status: "approved" })
            .eq("user_id", user.id)
            .eq("verification_type", "phone")
            .eq("phone_number", phone);
        } catch {}

        return json({ ok: true });
      }

      default:
        return json({ error: "Unknown action" }, 400);
    }
  } catch (e: any) {
    return json({ ok: false, error: e?.message || String(e) }, 200);
  }
});
