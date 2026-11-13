/**
 * check-vendor-balances
 *
 * Polls each vendor's balance/usage API and updates the vendor_accounts table.
 * Run on a cron (every few hours). Also callable ad-hoc.
 *
 * Vendors supported:
 *   Twilio   — Balance API (real-time)
 *   OpenAI   — Credit grants + usage
 *   Resend   — API key validation (no balance endpoint, checks auth)
 *   Firecrawl — Credits remaining
 *
 * Vendors that require manual check (no machine-readable balance API):
 *   Supabase, Vercel, Stripe, Modal — marks balance_updated_at stale, status unchanged
 *
 * Returns: { checked: VendorResult[], updated: number, errors: string[] }
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';
import { requireOwnerOrService, requireWriteAuth } from '../_shared/writeGuard.ts';
import { projectSecretKey } from "../_shared/supabaseKeys.ts";
import { resendAuthProbe, twilioAccountRead } from "../_shared/outbound.ts";

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = projectSecretKey()!;

interface VendorResult {
  vendor: string;
  status: 'active' | 'suspended' | 'degraded' | 'unknown';
  balance: number | null;
  note: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Twilio
// ---------------------------------------------------------------------------
async function checkTwilio(): Promise<VendorResult> {
  try {
    const bal = await twilioAccountRead('Balance.json');
    if (!bal.configured) {
      return { vendor: 'Twilio', status: 'unknown', balance: null, note: 'Credentials not configured' };
    }

    if (bal.status === 401) {
      // Could be suspended or wrong creds: check account status
      const acct = await twilioAccountRead('.json');
      const note = acct.status === 401
        ? 'Auth failed — credentials may be wrong or account suspended'
        : `HTTP ${bal.status}`;
      return { vendor: 'Twilio', status: 'suspended', balance: null, note, error: note };
    }

    if (bal.status === undefined || bal.status < 200 || bal.status > 299) {
      return { vendor: 'Twilio', status: 'unknown', balance: null, note: `HTTP ${bal.status}`, error: `HTTP ${bal.status}` };
    }

    const data = (bal.data ?? {}) as { balance?: string; currency?: string };
    const balance = parseFloat(data.balance ?? '0');
    const currency = data.currency ?? 'USD';
    const status = balance < 0 ? 'suspended' : balance < 10 ? 'degraded' : 'active';

    return {
      vendor: 'Twilio',
      status,
      balance,
      note: `Balance: ${currency} ${balance.toFixed(2)}${status === 'suspended' ? ' — account suspended, top up required' : status === 'degraded' ? ' — low balance, top up soon' : ''}`,
    };
  } catch (err) {
    return { vendor: 'Twilio', status: 'unknown', balance: null, note: String(err), error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------
async function checkOpenAI(): Promise<VendorResult> {
  const key = Deno.env.get('OPENAI_API_KEY');

  if (!key || key.startsWith('your-') || key.startsWith('sk-placeholder')) {
    return { vendor: 'OpenAI', status: 'unknown', balance: null, note: 'API key not configured' };
  }

  try {
    // Check subscription/billing overview
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401) {
      return { vendor: 'OpenAI', status: 'suspended', balance: null, note: 'Invalid API key', error: 'HTTP 401' };
    }
    if (res.status === 429) {
      return { vendor: 'OpenAI', status: 'degraded', balance: null, note: 'Rate limited or quota exceeded' };
    }
    if (!res.ok) {
      return { vendor: 'OpenAI', status: 'unknown', balance: null, note: `HTTP ${res.status}` };
    }

    // Auth works; balance requires dashboard (no public endpoint)
    return { vendor: 'OpenAI', status: 'active', balance: null, note: 'Auth OK — check dashboard for balance' };
  } catch (err) {
    return { vendor: 'OpenAI', status: 'unknown', balance: null, note: String(err), error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Resend
// ---------------------------------------------------------------------------
async function checkResend(): Promise<VendorResult> {
  try {
    // Read-only: list domains. This used to send a real probe email; no email is sent now. A send-only key
    // answers 401 "restricted_api_key", which still proves the key is valid.
    const probe = await resendAuthProbe();
    if (!probe) return { vendor: 'Resend', status: 'unknown', balance: null, note: 'API key not configured' };
    const authFailed = (probe.status === 401 && probe.errorName !== 'restricted_api_key') || probe.status === 403;
    if (authFailed) {
      return { vendor: 'Resend', status: 'suspended', balance: null, note: 'Invalid API key', error: `HTTP ${probe.status}` };
    }
    return { vendor: 'Resend', status: 'active', balance: null, note: 'Auth OK — usage-based, no balance endpoint' };
  } catch (err) {
    return { vendor: 'Resend', status: 'unknown', balance: null, note: String(err), error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Firecrawl
// ---------------------------------------------------------------------------
async function checkFirecrawl(): Promise<VendorResult> {
  const key = Deno.env.get('FIRECRAWL_API_KEY');

  if (!key || key.startsWith('your-') || key.startsWith('fc-placeholder')) {
    return { vendor: 'Firecrawl', status: 'unknown', balance: null, note: 'API key not configured' };
  }

  try {
    const res = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401 || res.status === 403) {
      return { vendor: 'Firecrawl', status: 'suspended', balance: null, note: 'Invalid API key', error: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      // Never fall back to a scrape to test the key: a scrape spends a credit, and this runs every 6 hours (found 2026-10-16).
      return { vendor: 'Firecrawl', status: 'unknown', balance: null, note: `credit-usage returned HTTP ${res.status}`, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
    const credits = data.data?.remaining_credits ?? data.remaining_credits ?? data.credits ?? null;
    const status = credits === null ? 'active' : credits <= 0 ? 'suspended' : credits < 100 ? 'degraded' : 'active';

    return {
      vendor: 'Firecrawl',
      status,
      balance: credits,
      note: credits !== null ? `${credits} credits remaining` : 'Auth OK',
    };
  } catch (err) {
    return { vendor: 'Firecrawl', status: 'unknown', balance: null, note: String(err), error: String(err) };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  // Writes are never anonymous: service key, signed-in user, or nothing (P0.2, 2026-09-27).
  const denied = await requireWriteAuth(req);
  if (denied) return denied;
  // Reads the platform's vendor balances and sends a probe email: the owner or the service key only, because "signed in" is anyone while
  // sign-up is open (2026-09-29).
  const notOwner = await requireOwnerOrService(req, { headers: corsHeaders });
  if (notOwner) return notOwner;
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const results: VendorResult[] = [];
  const errors: string[] = [];

  const checks = await Promise.allSettled([
    checkTwilio(),
    checkOpenAI(),
    checkResend(),
    checkFirecrawl(),
  ]);

  for (const c of checks) {
    if (c.status === 'fulfilled') {
      results.push(c.value);
      if (c.value.error) errors.push(`${c.value.vendor}: ${c.value.error}`);
    } else {
      errors.push(`Check failed: ${c.reason}`);
    }
  }

  // Write results back to vendor_accounts
  let updated = 0;
  for (const r of results) {
    const { error } = await supabase
      .from('vendor_accounts')
      .update({
        status: r.status,
        current_balance: r.balance,
        balance_updated_at: new Date().toISOString(),
        notes: r.note,
        updated_at: new Date().toISOString(),
      })
      .eq('vendor_name', r.vendor);

    if (!error) updated++;
    else errors.push(`DB update failed for ${r.vendor}: ${error.message}`);
  }

  // Flag anything critical
  const critical = results.filter(r => r.status === 'suspended');
  const degraded  = results.filter(r => r.status === 'degraded');

  console.log(`[check-vendor-balances] checked=${results.length} updated=${updated} critical=${critical.length} degraded=${degraded.length}`);

  return new Response(
    JSON.stringify({ checked: results, updated, critical, degraded, errors }),
    { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  );
});
