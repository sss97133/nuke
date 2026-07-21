#!/usr/bin/env node
// Re-adjudicate every website this pipeline ASSERTED, against the hardened shared gate.
//
// A wrong website poisons every downstream field (description, logo, catalogue, contact),
// so a discovered URL is re-tried against the current gate and RETRACTED when it no longer
// clears the bar. Retraction here is not deletion of testimony: it removes a value this
// pipeline itself wrote minutes ago, and the retraction plus its reason is recorded in
// metadata.web_discovery.retracted so the audit trail survives.
//
//   node scripts/concierge/audit-discovered-websites.mjs [--apply]

import { createClient } from '@supabase/supabase-js';
import { adjudicate, decode, sameBusiness } from './_org_entity_gate.mjs';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

async function paged(build, key = 'id') {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await build().order(key).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

// only rows THIS pipeline asserted — never touch a website that came from the directory
const rows = (await paged(() => db.from('organizations')
  .select('id,name,website,metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('metadata->web_discovery', 'is', null)
  .not('website', 'is', null)))
  .filter((o) => o.metadata?.web_discovery?.website);

console.error(`websites asserted by discovery: ${rows.length}  (apply=${APPLY})`);

// A host claimed by several DIFFERENTLY-named orgs is a portal/parent, not any one org's
// own site — the same rule classify-org-domains.mjs applies to the directory's own URLs.
// (fredmanagement-stbarth.com was landing on five separate villa-management companies.)
const claims = new Map();
for (const o of rows) {
  try {
    const h = new URL(o.metadata.web_discovery.website).hostname.replace(/^www\./, '').toLowerCase();
    if (!claims.has(h)) claims.set(h, []);
    claims.get(h).push(decode(o.name));
  } catch { /* adjudicated as bad_url below */ }
}

const kept = [], retracted = [];

for (const o of rows) {
  const wd = o.metadata.web_discovery;
  const proof = wd.evidence?.find((e) => e.finalUrl === wd.website) || {};
  let u;
  try { u = new URL(wd.website); } catch { retracted.push({ o, verdict: 'bad_url', reason: 'unparseable' }); continue; }
  const v = adjudicate({
    orgName: decode(o.name),
    host: u.hostname.replace(/^www\./, '').toLowerCase(),
    path: u.pathname,
    island: proof.island_presence ?? wd.website_proof?.island_presence,
    phoneOnPage: proof.phoneOnPage ?? wd.website_proof?.phone_corroborated,
  });
  const host = u.hostname.replace(/^www\./, '').toLowerCase();
  // collapse duplicate directory rows for one business; what remains are distinct businesses
  const names = claims.get(host) || [];
  const distinct = names.reduce((acc, n) => (acc.some((m) => sameBusiness(m, n)) ? acc : [...acc, n]), []);
  if (distinct.length > 1) { retracted.push({ o, verdict: 'shared_portal', reason: `host serves ${distinct.length} distinct businesses (${distinct.slice(0, 3).join(' / ')}) — portal/parent, not an own site` }); continue; }
  if (v.verdict === 'own_site') kept.push({ o, v });
  else retracted.push({ o, verdict: v.verdict, reason: v.reason });
}

console.error(`\nKEPT ${kept.length} · RETRACTED ${retracted.length}`);
console.error('\n--- RETRACTED ---');
for (const r of retracted) console.error(`  ${decode(r.o.name).slice(0, 36).padEnd(38)} ${String(r.o.website).slice(0, 62).padEnd(64)} ${r.verdict}`);

if (!APPLY) { console.error('\ndry run — nothing written'); process.exit(0); }

for (const r of retracted) {
  const wd = r.o.metadata.web_discovery;
  const block = {
    ...wd,
    website: null,
    trust: null,
    retracted: {
      url: r.o.website,
      verdict: r.verdict,
      reason: r.reason,
      retracted_at: new Date().toISOString(),
      by: 'scripts/concierge/audit-discovered-websites.mjs',
      note: 'asserted by an earlier, looser pass of this same pipeline; re-adjudicated against the hardened gate and withdrawn',
    },
  };
  const { error } = await db.from('organizations')
    .update({ website: null, metadata: { ...r.o.metadata, web_discovery: block } })
    .eq('id', r.o.id);
  if (error) console.error('WRITE FAIL', r.o.name, error.message);
}
console.error(`\nretracted ${retracted.length} websites; ${kept.length} stand`);

// A social handle harvested off a candidate PAGE inherits that page's identity. When the
// page is retracted, so is the handle — otherwise METEO FRANCE keeps @meteofrance and
// SAINT-BARTH ECHECS keeps the national chess federation's page, which is precisely the
// clean-looking lie the frame forbids. Handles found by SEARCH stand on their own evidence
// (they carry an island_basis) and are untouched.
let socDropped = 0;
for (const r of retracted) {
  const wd = r.o.metadata.web_discovery;
  const searchBacked = new Set((wd.evidence || []).filter((e) => e.network && e.island_basis).map((e) => `${e.network}:${e.handle}`));
  const { data: cur } = await db.from('organizations').select('social_links, metadata').eq('id', r.o.id).single();
  if (!cur) continue;
  const links = cur.social_links || {};
  const keep = {}; const dropped = {};
  for (const [k, v] of Object.entries(links)) {
    if (k.startsWith('_')) { keep[k] = v; continue; }
    if (searchBacked.has(`${k}:${v}`)) keep[k] = v; else dropped[k] = v;
  }
  if (!Object.keys(dropped).length) continue;
  const block = { ...(cur.metadata?.web_discovery || {}) };
  block.retracted = { ...(block.retracted || {}), socials_dropped: dropped, socials_reason: 'harvested from a page that was retracted — the handle inherited the page\'s identity, not the org\'s' };
  const { error } = await db.from('organizations')
    .update({ social_links: Object.keys(keep).filter((k) => !k.startsWith('_')).length ? keep : {}, metadata: { ...cur.metadata, web_discovery: block } })
    .eq('id', r.o.id);
  if (!error) socDropped += Object.keys(dropped).length;
}
console.error(`also dropped ${socDropped} page-harvested social handles whose source page was retracted`);
