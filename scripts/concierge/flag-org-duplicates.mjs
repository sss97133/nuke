#!/usr/bin/env node
// Detect and FLAG duplicate L'Officiel concierge org rows. Never merges, never deletes.
//
// Doctrine:
//   - Merging is a testimony operation and an OWNER decision. This script only
//     records the claim, with its evidence, on both rows.
//   - The flag is written to metadata.duplicate_candidate so it is drillable
//     from the profile and reversible by clearing one key.
//   - Evidence is measured, never asserted: which fields are byte-identical
//     across the pair, and which witness (if any) supports each spelling.
//
// The measured class on this island: the directory-saintbarth scrape ran twice
// on 2026-01-30 with different apostrophe handling. Every no-apostrophe row was
// created in the 14:02 pass; the apostrophe rows came from the later passes.
// The pair is otherwise byte-identical (phone, website, coordinates, category).
//
// NOTE the survivor is NOT mechanically the apostrophe row. Checked against the
// operators' own sites: lisolastbarth.com renders "L'Isola" (apostrophe row is
// right) but barthloc.com renders "Barthloc" (apostrophe row is WRONG). The
// canonical spelling is a per-pair question for a third witness or the owner.
//
// Usage:
//   node scripts/concierge/flag-org-duplicates.mjs           # dry run
//   node scripts/concierge/flag-org-duplicates.mjs --apply

import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();

async function pagedAll(build) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw error;
    rows.push(...(data ?? []));
    if ((data ?? []).length < 1000) break;
  }
  return rows;
}

const orgs = await pagedAll((from, to) =>
  db.from('organizations')
    .select('id, name, website, phone, latitude, longitude, description, logo_url, created_at, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .order('id')
    .range(from, to));

const FOLD = { à: 'a', â: 'a', ä: 'a', á: 'a', ã: 'a', ç: 'c', é: 'e', è: 'e', ê: 'e', ë: 'e', í: 'i', ì: 'i', î: 'i', ï: 'i', ñ: 'n', ó: 'o', ò: 'o', ô: 'o', ö: 'o', õ: 'o', ú: 'u', ù: 'u', û: 'u', ü: 'u', ý: 'y', ÿ: 'y' };
const nkey = (s) => (s || '').toLowerCase().replace(/./g, (c) => FOLD[c] ?? c).replace(/[^a-z0-9]/g, '');
const digits = (s) => (s || '').replace(/[^0-9]/g, '');
const coord = (o) => (o.latitude == null ? null : `${Number(o.latitude).toFixed(6)},${Number(o.longitude).toFixed(6)}`);

const groups = new Map();
for (const o of orgs) {
  const k = nkey(o.name);
  if (!k) continue;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(o);
}

const pairs = [];
for (const [k, rows] of groups) {
  if (rows.length < 2) continue;
  const ev = {
    same_phone: new Set(rows.map((r) => digits(r.phone) || '~')).size === 1,
    same_website: new Set(rows.map((r) => r.website || '~')).size === 1,
    same_coordinates: new Set(rows.map((r) => coord(r) || '~')).size === 1,
    same_subcategory: new Set(rows.map((r) => r.metadata?.subcategory_slug || '~')).size === 1,
    same_source: new Set(rows.map((r) => r.metadata?.source || '~')).size === 1,
  };
  const strength = Object.values(ev).filter(Boolean).length;
  pairs.push({ key: k, rows, ev, strength, apostrophe_variant: new Set(rows.map((r) => /['’]/.test(r.name))).size === 2 });
}
pairs.sort((a, b) => b.strength - a.strength || a.key.localeCompare(b.key));

console.error(`=== DUPLICATE CANDIDATES: ${pairs.length} groups, ${pairs.reduce((n, p) => n + p.rows.length, 0)} rows ===\n`);
const hist = {};
for (const p of pairs) hist[p.strength] = (hist[p.strength] || 0) + 1;
console.error('evidence strength (of 5 identical fields):', JSON.stringify(hist));
console.error(`apostrophe-variant pairs: ${pairs.filter((p) => p.apostrophe_variant).length}\n`);
for (const p of pairs.slice(0, 12)) {
  console.error(`[${p.strength}/5] ${p.rows.map((r) => `"${r.name}"`).join('  ==  ')}`);
  console.error(`        ${Object.entries(p.ev).filter(([, v]) => v).map(([k2]) => k2).join(', ') || 'no identical fields'}`);
}

if (!APPLY) {
  console.error('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}

let n = 0;
for (const p of pairs) {
  for (const row of p.rows) {
    const peers = p.rows.filter((r) => r.id !== row.id);
    const { data: cur, error } = await db.from('organizations').select('metadata').eq('id', row.id).single();
    if (error) { console.error('READ FAIL', row.id, error.message); continue; }
    const upd = {
      metadata: {
        ...(cur.metadata || {}),
        duplicate_candidate: {
          peers: peers.map((r) => ({ id: r.id, name: r.name, created_at: r.created_at })),
          normalized_key: p.key,
          evidence: p.ev,
          evidence_strength: `${p.strength}/5`,
          class: p.apostrophe_variant ? 'apostrophe_variant_double_ingest' : 'name_variant',
          detected_at: NOW,
          detected_by: 'flag-org-duplicates.mjs',
          status: 'unresolved',
          note: 'NOT merged. Merge/collapse is an owner decision and a testimony operation. Canonical spelling needs a third witness (the operator\'s own site) — it is NOT always the apostrophe row.',
        },
      },
    };
    const { error: e } = await db.from('organizations').update(upd).eq('id', row.id);
    if (e) console.error('WRITE FAIL', row.id, e.message); else n++;
  }
}
console.error(`\nflagged ${n} rows across ${pairs.length} duplicate groups`);
