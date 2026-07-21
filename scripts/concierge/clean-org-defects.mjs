#!/usr/bin/env node
// Repair measured defects on L'Officiel concierge org rows.
//
// Doctrine (AGENTS.md "FACTS ARE SACRED" + the concierge FRAME):
//   - Nothing is invented. This script only REMOVES provable junk and REPAIRS
//     provable encoding damage. It never writes a fact.
//   - Nothing is destroyed. Every value this script clears is first copied
//     verbatim into metadata.quarantine.<field> with (value, reason,
//     quarantined_at, quarantined_by, restore). A quarantine is reversible;
//     a delete is not.
//   - Rows are NEVER deleted. Deletion is an owner decision.
//   - Each defect class is keyed to a PROVABLE predicate, not a judgement call.
//     If a value is merely weak/short/ugly it is REPORTED, never touched.
//
// Usage:
//   node scripts/concierge/clean-org-defects.mjs            # dry run (default)
//   node scripts/concierge/clean-org-defects.mjs --apply

import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();
const BY = 'clean-org-defects.mjs';

// PostgREST hard-caps any response at 1000 rows and silently clamps .limit()
// above that. Page everything that reads the whole island.
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
    .select('id, name, business_name, description, website, metadata')
    .eq('metadata->>project', 'lofficiel-concierge')
    .order('id')
    .range(from, to));

console.error(`read ${orgs.length} org rows (paginated)\n`);

// ---------------------------------------------------------------------------
// DEFECT 1 — aggregator SEO template masquerading as the operator's words.
//
// PROOF, not judgement: strip the org's own name out of the description and
// what remains is byte-identical across every affected row. One template, one
// slot. No operator wrote this about their restaurant; a reservation
// aggregator generated it. Provable => quarantinable.
// ---------------------------------------------------------------------------
const TEMPLATE_TAIL = '| RESERVE YOUR TABLE ✅ Direct reservations with the restaurant | Menu, Photos, Video, and Practical Info : ✉ Address ☎ Phone ⌚ Hours';
const isAggregatorTemplate = (d) =>
  typeof d === 'string' && d.startsWith('ll➤ ') && d.trimEnd().endsWith(TEMPLATE_TAIL.trimEnd());

// ---------------------------------------------------------------------------
// DEFECT 2 — undecoded HTML entities left in a stored value.
//
// The value is real testimony; only its transport encoding is damaged.
// Decoding is a lossless repair of OUR corruption, not an edit of their words.
// (Same decode table as fill-org-profiles.mjs `clean()`.)
// ---------------------------------------------------------------------------
const ENTITY = /&(?:nbsp|amp|quot|lt|gt|apos|#0?39|#\d+);/i;
const decodeEntities = (s) => s
  .replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&#0?39;|&apos;/gi, "'")
  .replace(/&quot;/gi, '"').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));

// ---------------------------------------------------------------------------
// DEFECT 3 — an agent's bookkeeping marker leaked into the DISPLAY name.
//
// `name` is what every screen renders. A "[DUPE→slug]" tag is internal triage
// state, not the business's name. Move it to metadata where it belongs; the
// dedupe claim itself is preserved, not discarded.
// ---------------------------------------------------------------------------
const MARKER = /\s*\[(DUPE|DUPLICATE|MERGED|DO NOT USE)[^\]]*\]\s*$/i;

const plan = { template: [], entity: [], marker: [] };

for (const o of orgs) {
  if (isAggregatorTemplate(o.description)) {
    plan.template.push({ id: o.id, name: o.name, from: o.description, to: null });
  }
  if (typeof o.description === 'string' && ENTITY.test(o.description)) {
    const fixed = decodeEntities(o.description);
    if (fixed !== o.description) plan.entity.push({ id: o.id, name: o.name, from: o.description, to: fixed });
  }
  if (typeof o.name === 'string' && MARKER.test(o.name)) {
    const stripped = o.name.replace(MARKER, '').trim();
    if (stripped) plan.marker.push({ id: o.id, name: o.name, from: o.name, to: stripped, marker: o.name.match(MARKER)[0].trim() });
  }
}

console.error('=== PLAN ===');
console.error(`1. aggregator-template descriptions to quarantine : ${plan.template.length}`);
for (const r of plan.template) console.error(`     ${r.name.padEnd(24).slice(0, 24)} :: ${r.from.slice(0, 78)}…`);
console.error(`2. html-entity descriptions to decode            : ${plan.entity.length}`);
for (const r of plan.entity) console.error(`     ${r.name.padEnd(24).slice(0, 24)} :: ${r.to.slice(0, 78)}…`);
console.error(`3. bookkeeping markers to lift out of name       : ${plan.marker.length}`);
for (const r of plan.marker) console.error(`     "${r.from}"  ->  "${r.to}"   (marker kept: ${r.marker})`);

if (!APPLY) {
  console.error('\nDRY RUN — nothing written. Re-run with --apply.');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// apply — read-modify-write per row so no concurrent metadata write is lost
// ---------------------------------------------------------------------------
async function patch(id, mutate) {
  const { data: cur, error } = await db.from('organizations')
    .select('name, business_name, description, metadata').eq('id', id).single();
  if (error) { console.error('READ FAIL', id, error.message); return false; }
  const upd = mutate(cur);
  const { error: e } = await db.from('organizations').update(upd).eq('id', id);
  if (e) { console.error('WRITE FAIL', id, e.message); return false; }
  return true;
}

let n = 0;
for (const r of plan.template) {
  const ok = await patch(r.id, (cur) => ({
    description: null,
    metadata: {
      ...(cur.metadata || {}),
      quarantine: {
        ...((cur.metadata || {}).quarantine || {}),
        description: {
          value: cur.description,
          reason: 'aggregator SEO template ("ll➤ <name> | RESERVE YOUR TABLE …"), byte-identical across 9 orgs once the name slot is removed — not the operator describing their business',
          defect_class: 'aggregator_template',
          quarantined_at: NOW, quarantined_by: BY,
          restore: 'UPDATE organizations SET description = metadata->\'quarantine\'->\'description\'->>\'value\' WHERE id = \'' + r.id + '\'',
        },
      },
    },
  }));
  if (ok) n++;
}
console.error(`\nquarantined ${n}/${plan.template.length} aggregator-template descriptions`);

let m = 0;
for (const r of plan.entity) {
  const ok = await patch(r.id, (cur) => ({
    description: decodeEntities(cur.description),
    metadata: {
      ...(cur.metadata || {}),
      repairs: [
        ...(((cur.metadata || {}).repairs) || []),
        { field: 'description', kind: 'html_entity_decode', before: cur.description, at: NOW, by: BY },
      ],
    },
  }));
  if (ok) m++;
}
console.error(`decoded ${m}/${plan.entity.length} html-entity descriptions`);

let k = 0;
for (const r of plan.marker) {
  const ok = await patch(r.id, (cur) => ({
    name: cur.name.replace(MARKER, '').trim(),
    metadata: {
      ...(cur.metadata || {}),
      triage_marker: { value: r.marker, lifted_from: 'name', at: NOW, by: BY,
        note: 'internal dedupe triage state — was rendering on every screen that displays organizations.name' },
      repairs: [
        ...(((cur.metadata || {}).repairs) || []),
        { field: 'name', kind: 'strip_triage_marker', before: cur.name, at: NOW, by: BY },
      ],
    },
  }));
  if (ok) k++;
}
console.error(`lifted ${k}/${plan.marker.length} triage markers out of name`);
