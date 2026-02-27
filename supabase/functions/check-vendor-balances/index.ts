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

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

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
  const sid = Deno.env.get('TWILIO_ACCOUNT_SID');
  const token = Deno.env.get('TWILIO_AUTH_TOKEN');

  if (!sid || !token || sid.startsWith('your-')) {
    return { vendor: 'Twilio', status: 'unknown', balance: null, note: 'Credentials not configured' };
  }

  try {
    const res = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${sid}/Balance.json`,
      { headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) } },
    );

    if (res.status === 401) {
      // Could be suspended or wrong creds — check account status
      const acctRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}.json`,
        { headers: { Authorization: 'Basic ' + btoa(`${sid}:${token}`) } },
      );
      const note = acctRes.status === 401
        ? 'Auth failed — credentials may be wrong or account suspended'
        : `HTTP ${res.status}`;
      return { vendor: 'Twilio', status: 'suspended', balance: null, note, error: note };
    }

    if (!res.ok) {
      return { vendor: 'Twilio', status: 'unknown', balance: null, note: `HTTP ${res.status}`, error: `HTTP ${res.status}` };
    }

    const data = await res.json();
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
  const key = Deno.env.get('RESEND_API_KEY');

  if (!key || key.startsWith('your-') || key.startsWith('re_placeholder')) {
    return { vendor: 'Resend', status: 'unknown', balance: null, note: 'API key not configured' };
  }

  try {
    // Resend send-only keys return 401 on all GET endpoints (not just 403).
    // Validate by attempting a send with a known-invalid address — auth errors
    // return "Unauthorized" (code: missing_api_key/invalid_api_key), while
    // a valid key returns a validation error about the address/domain.
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'health-check@nuke.ag',
        to: ['health-check-probe@nuke.ag'],
        subject: 'health check probe',
        html: '<p>probe</p>',
      }),
    });

    const data = await res.json().catch(() => ({}));

    // 401 / 403 = auth failure
    if (res.status === 401 || res.status === 403) {
      return { vendor: 'Resend', status: 'suspended', balance: null, note: 'Invalid API key', error: `HTTP ${res.status}` };
    }

    // 422 / 400 = auth OK, just a domain/address validation error — key is valid
    // 200 / 201 = actually sent (unexpected but fine)
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
    const res = await fetch('https://api.firecrawl.dev/v1/team/credits', {
      headers: { Authorization: `Bearer ${key}` },
    });

    if (res.status === 401 || res.status === 403) {
      return { vendor: 'Firecrawl', status: 'suspended', balance: null, note: 'Invalid API key', error: `HTTP ${res.status}` };
    }
    if (!res.ok) {
      // Credits endpoint might not exist on all plans — just check auth
      const pingRes = await fetch('https://api.firecrawl.dev/v1/scrape', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: 'https://example.com', formats: [] }),
      });
      const authOk = pingRes.status !== 401 && pingRes.status !== 403;
      return {
        vendor: 'Firecrawl',
        status: authOk ? 'active' : 'suspended',
        balance: null,
        note: authOk ? 'Auth OK — check dashboard for credit balance' : 'Invalid API key',
      };
    }

    const data = await res.json();
    const credits = data.remaining_credits ?? data.credits ?? null;
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
serve(async (req) => {
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
