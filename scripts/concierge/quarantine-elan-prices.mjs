import { createClient } from '@supabase/supabase-js';
const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// The 9 elanvillarental rows carry base_price values 27x-155x below the merchant's own
// published rates (Villa Grace stored 804 USD/wk; its live page publishes 22,000-125,000).
// A wrong price shown to a customer is the worst defect this product can produce, so the
// value is removed and preserved. It is NOT re-derived here: Elan is an unrun turnstile leg
// (their sitemap lists 186 villas, we hold 9), and guessing a replacement would repeat the
// original error in the opposite direction.
const { data, error } = await sb.from('properties')
  .select('id,name,base_price,price_currency,price_period,source_url,metadata')
  .ilike('source_url', '%elanvillarental%');
if (error) throw error;

const now = new Date().toISOString();
for (const r of data) {
  if (r.base_price == null) { console.log(`  SKIP ${r.name} — already null`); continue; }
  const metadata = {
    ...(r.metadata || {}),
    price_quarantine: {
      reason: 'contradicted_by_merchant_published_rate',
      detail: `stored base_price ${r.base_price} ${r.price_currency}/${r.price_period} is orders of magnitude below the rate published on the villa's own Elan page (verified 2026-07-20: Villa Grace stored 804, published 22,000-125,000 USD/week)`,
      method: 'live_page_verification',
      trust: 'measured',
      nulled: true,
      base_price_as_found: r.base_price,
      price_currency_as_found: r.price_currency,
      price_period_as_found: r.price_period,
      observed_at: now,
      needs: 'run the Elan turnstile leg (186 villas in their sitemap) and land real rates into price_observations',
      restore: `UPDATE properties SET base_price=${r.base_price} WHERE id='${r.id}';`,
    },
  };
  console.log(`  NULL ${String(r.name).padEnd(18)} was ${r.base_price} ${r.price_currency}/${r.price_period}`);
  if (APPLY) {
    const { error: e } = await sb.from('properties').update({ base_price: null, metadata }).eq('id', r.id);
    if (e) throw e;
  }
}
console.log(APPLY ? '\nAPPLIED' : '\nDRY RUN — re-run with --apply');
