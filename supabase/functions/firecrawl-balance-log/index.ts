/**
 * firecrawl-balance-log
 *
 * Hourly: reads the Firecrawl team's remaining credits (GET /v1/team/credit-usage, a free call, no credits spent) and appends
 * (read_at, remaining_credits) to firecrawl_balance_log. v_firecrawl_balance_check compares each step with firecrawl_spend_log, so a
 * drop the ledger does not explain shows up with its time range. Never calls a scrape endpoint.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async () => {
  const key = Deno.env.get('FIRECRAWL_API_KEY');
  if (!key) return new Response(JSON.stringify({ ok: false, error: 'no key' }), { status: 500 });
  const res = await fetch('https://api.firecrawl.dev/v1/team/credit-usage', { headers: { Authorization: `Bearer ${key}` } });
  if (!res.ok) return new Response(JSON.stringify({ ok: false, status: res.status }), { status: 502 });
  const d = (await res.json())?.data ?? {};
  if (typeof d.remaining_credits !== 'number') return new Response(JSON.stringify({ ok: false, error: 'no remaining_credits' }), { status: 502 });
  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  const { error } = await supabase.from('firecrawl_balance_log').insert({
    remaining_credits: d.remaining_credits,
    plan_credits: d.plan_credits ?? null,
    billing_period_end: d.billing_period_end ?? null,
  });
  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, remaining_credits: d.remaining_credits }), { headers: { 'Content-Type': 'application/json' } });
});
