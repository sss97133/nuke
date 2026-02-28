#!/usr/bin/env node
/**
 * sonar-enrich-batch.mjs - Batch org enrichment via Perplexity Sonar API
 *
 * Usage:
 *   dotenvx run -- node scripts/sonar-enrich-batch.mjs
 *   dotenvx run -- node scripts/sonar-enrich-batch.mjs --limit 50 --dry-run
 *   dotenvx run -- node scripts/sonar-enrich-batch.mjs --model sonar --concurrency 5
 */

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const get = f => { const i = args.indexOf(f); return i !== -1 ? args[i+1] : null; };
const has = f => args.includes(f);

const LIMIT       = get('--limit') ? parseInt(get('--limit')) : Infinity;
const DRY_RUN     = has('--dry-run');
const MODEL       = get('--model') || 'sonar-pro';
const CONCURRENCY = get('--concurrency') ? Math.min(parseInt(get('--concurrency')), 10) : 3;
const ONLY_TYPE   = get('--type') || null;
const WITH_NO_SITE = has('--include-no-website');

if (!process.env.PERPLEXITY_API_KEY) {
  console.error('PERPLEXITY_API_KEY not set. Get at https://www.perplexity.ai/settings/api');
  process.exit(1);
}

const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const KEY = process.env.PERPLEXITY_API_KEY;

async function fetchQueue() {
  let q = supabase
    .from('organizations')
    .select('id, business_name, website, city, state')
    .or('enrichment_status.is.null,enrichment_status.eq.pending,enrichment_status.eq.unenriched')
    .order('created_at', { ascending: true });
  if (ONLY_TYPE) q = q.eq('entity_type', ONLY_TYPE);
  if (!WITH_NO_SITE) q = q.not('website', 'is', null);
  const { data, error } = await q;
  if (error) { console.error('Queue: ' + error.message); process.exit(1); }
  const all = data || [];
  return LIMIT < Infinity ? all.slice(0, LIMIT) : all;
}

async function callSonar(name, url) {
  const sub = (name && url) ? name + ' (' + url + ')' : (name || url);
  const prompt = 'Research this automotive business: ' + sub + '\nReturn ONLY JSON with: business_name, description, business_type (dealer|auction_house|restoration_shop|parts_supplier|other), email, phone, address, city, state, zip_code, country, year_established, employee_count_estimate, specializations (array), services_offered (array), brands_carried (array), inventory_url, social_facebook, social_instagram, social_twitter, social_youtube, social_linkedin, notes';
  const t0 = Date.now();
  const r = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: [
      { role: 'system', content: 'Business intelligence researcher for collector car industry. Return ONLY valid JSON, no markdown.' },
      { role: 'user', content: prompt }
    ], search_context_size: 'medium', temperature: 0.1, max_tokens: 1200 }),
  });
  const ms = Date.now() - t0;
  if (!r.ok) { const b = await r.text(); throw new Error(r.status + ': ' + b.slice(0,100)); }
  const d = await r.json();
  const content = d.choices?.[0]?.message?.content || '';
  const u = d.usage || {};
  const rates = MODEL === 'sonar-pro' ? { i:3, o:15, req:0.010 } : { i:1, o:1, req:0.008 };
  const cost = ((u.prompt_tokens||0)*rates.i + (u.completion_tokens||0)*rates.o)/1e6 + rates.req;
  return { content, ms, cost };
}

function toOrg(p) {
  if (!p) return null;
  const cl = v => (v && v !== 'null' && v !== 'N/A' ? String(v).trim() : null);
  const sl = {};
  if (p.social_facebook) sl.facebook = p.social_facebook;
  if (p.social_instagram) sl.instagram = p.social_instagram;
  if (p.social_linkedin) sl.linkedin = p.social_linkedin;
  if (p.social_twitter) sl.twitter = p.social_twitter;
  if (p.social_youtube) sl.youtube = p.social_youtube;
  const yr = p.year_established ? parseInt(p.year_established) : null;
  const yib = yr && yr > 1800 && yr <= 2026 ? 2026 - yr : null;
  const arr = v => Array.isArray(v) && v.length ? v.filter(Boolean) : null;
  return {
    description: cl(p.description), business_type: cl(p.business_type),
    email: cl(p.email), phone: cl(p.phone), website: cl(p.website),
    address: cl(p.address), city: cl(p.city), state: cl(p.state),
    zip_code: cl(p.zip_code), country: cl(p.country) || 'USA',
    years_in_business: yib, employee_count: p.employee_count_estimate ? parseInt(p.employee_count_estimate) : null,
    specializations: arr(p.specializations), services_offered: arr(p.services_offered),
    brands_carried: arr(p.brands_carried), inventory_url: cl(p.inventory_url),
    social_links: Object.keys(sl).length ? sl : null,
    metadata: { sonar_notes: cl(p.notes), model: MODEL },
    enrichment_status: 'enriched', enrichment_sources: ['perplexity-sonar'],
    last_enriched_at: new Date().toISOString(),
  };
}

function extractJSON(text) {
  const s = text.replace(/^```(?:json)?\s*/im,'').replace(/\s*```\s*$/m,'').trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('j}');
  if (a < 0 || b < 0) return null;
  try { return JSON.parse(s.slice(a, b+1)); } catch { return null; }
}

async function enrichOne(org) {
  try {
    const { content, ms, cost } = await callSonar(org.business_name, org.website);
    const p = extractJSON(content);
    if (!p) return { id: org.id, ok: false, error: 'json_parse', cost };
    const payload = toOrg(p);
    Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k]);
    if (!DRY_RUN) {
      const { error } = await supabase.from('organizations').update(payload).eq('id', org.id);
      if (error) return { id: org.id, ok: false, error: error.message, cost };
    }
    return { id: org.id, ok: true, cost, ms };
  } catch(e) { return { id: org.id, ok: false, error: e.message, cost: 0 }; }
}

async function pool(items, fn, n) {
  const q = [...items]; const res = [];
  await Promise.all(Array(Math.min(n, items.length)).fill(0).map(async () => {
    let x; while (x = q.shift()) res.push(await fn(x));
  }));
  return res;
}

const orgs = await fetchQueue();
console.log('\nSonar Batch  model=' + MODEL + '  concurrency=' + CONCURRENCY + '  dry=' + DRY_RUN);
console.log('Queue: ' + orgs.length + ' orgs  est ~$' + (orgs.length * (MODEL==='sonar-pro'?0.012:0.006)).toFixed(2));
console.log('-'.repeat(60));
if (!orgs.length) { console.log('Nothing to enrich.'); process.exit(0); }

let done=0, ok=0, fail=0, cost=0;
const t0 = Date.now(), errs = [];

await pool(orgs, async org => {
  const r = await enrichOne(org);
  done++; cost += r.cost||0;
  if (r.ok) ok++; else { fail++; errs.push({ id:r.id, e:r.error }); }
  const pct = ((done/orgs.length)*100|0);
  const rate = (done/Math.max((Date.now()-t0)/60000, 0.01)|0);
  process.stdout.write('\r[' + pct + '%] ' + done + '/' + orgs.length + ' ok=' + ok + ' fail=' + fail + ' \$' + cost.toFixed(2) + ' ' + rate + '/min   ');
  return r;
}, CONCURRENCY);

const secs = ((Date.now()-t0)/1000|0);
console.log('\n\nDone ' + secs + 's  ok=' + ok + '/' + orgs.length + '  fail=' + fail + '  cost=\$' + cost.toFixed(2) + '  avg=\$' + (cost/Math.max(orgs.length,1)).toFixed(4));
if (errs.length) errs.slice(0,10).forEach(e => console.log('  FAIL ' + e.id + ': ' + e.e));
if (DRY_RUN) console.log('(DRY RUN)');
