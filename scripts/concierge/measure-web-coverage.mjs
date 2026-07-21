#!/usr/bin/env node
// Coverage of the web-presence axis across the L'Officiel concierge org population.
// Reports movement toward a target, never raw row counts as an accomplishment.
// Also reports near-duplicate org names as QUARANTINE CANDIDATES — never deletes
// (deletion is owner-only).
//
//   node scripts/concierge/measure-web-coverage.mjs

import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');
const compact = (s) => decode(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// PostgREST hard-caps every response at 1000 rows and silently clamps .limit() above it.
async function paged(table, sel, build, key) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await build(db.from(table).select(sel)).order(key).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const view = await paged('v_org_authentication', 'org_id,relevance_tier,concierge_category', (q) => q, 'org_id');
const vmap = new Map(view.map((v) => [v.org_id, v]));
const orgs = (await paged('organizations', 'id,name,website,social_links,description,metadata',
  (q) => q.eq('metadata->>project', 'lofficiel-concierge'), 'id'))
  .map((o) => ({ ...o, name: decode(o.name), tier: vmap.get(o.id)?.relevance_tier ?? 9, cat: vmap.get(o.id)?.concierge_category || 'unknown' }));

const handles = (o) => Object.keys(o.social_links || {}).filter((k) => !k.startsWith('_'));
const anyWeb = (o) => !!o.website || handles(o).length > 0;

const pct = (n, d) => `${n} / ${d} (${(100 * n / d).toFixed(1)}%)`;
console.log(`\n=== WEB PRESENCE COVERAGE — ${orgs.length} St Barth orgs ===`);
console.log(`  website on record   : ${pct(orgs.filter((o) => o.website).length, orgs.length)}`);
console.log(`  instagram handle    : ${pct(orgs.filter((o) => handles(o).includes('instagram')).length, orgs.length)}`);
console.log(`  facebook page       : ${pct(orgs.filter((o) => handles(o).includes('facebook')).length, orgs.length)}`);
console.log(`  ANY web presence    : ${pct(orgs.filter(anyWeb).length, orgs.length)}`);
console.log(`  measured as ABSENT  : ${pct(orgs.filter((o) => !anyWeb(o)).length, orgs.length)}`);

console.log('\n--- by relevance tier ---');
for (const t of [...new Set(orgs.map((o) => o.tier))].sort()) {
  const g = orgs.filter((o) => o.tier === t);
  console.log(`  t${t}  n=${String(g.length).padEnd(4)} website ${String(g.filter((o) => o.website).length).padStart(4)}  ig ${String(g.filter((o) => handles(o).includes('instagram')).length).padStart(4)}  fb ${String(g.filter((o) => handles(o).includes('facebook')).length).padStart(4)}  any ${pct(g.filter(anyWeb).length, g.length)}`);
}
console.log('\n--- by concierge category ---');
for (const c of [...new Set(orgs.map((o) => o.cat))].sort()) {
  const g = orgs.filter((o) => o.cat === c);
  console.log(`  ${c.padEnd(18)} n=${String(g.length).padEnd(4)} website ${String(g.filter((o) => o.website).length).padStart(4)}  any ${pct(g.filter(anyWeb).length, g.length)}`);
}

// what the discovery stage unlocked for the DESCRIPTION stage downstream
const disc = orgs.filter((o) => o.metadata?.web_discovery);
console.log(`\n--- discovery stage ---`);
console.log(`  orgs swept                  : ${disc.length}`);
console.log(`  now have a site AND no desc : ${orgs.filter((o) => o.website && !o.description).length}  <- the description stage's new queue`);

// QUARANTINE CANDIDATES — reported, never acted on. Deletion is owner-only.
const byName = new Map();
for (const o of orgs) {
  const k = compact(o.name);
  if (!byName.has(k)) byName.set(k, []);
  byName.get(k).push(o);
}
const dupes = [...byName.entries()].filter(([, v]) => v.length > 1);
console.log(`\n--- QUARANTINE CANDIDATES (exact name collision after normalisation) — ${dupes.length} groups, NOT deleted ---`);
for (const [k, v] of dupes.slice(0, 25)) console.log(`  ${k.slice(0, 40).padEnd(42)} ${v.map((o) => `${o.name} [${o.id.slice(0, 8)}]`).join('  ||  ')}`);
