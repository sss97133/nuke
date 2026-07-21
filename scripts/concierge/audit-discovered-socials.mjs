#!/usr/bin/env node
// Re-adjudicate every SOCIAL HANDLE this pipeline asserted.
//
// WHY THIS EXISTS: audit-discovered-websites.mjs cleans up handles harvested off a page it
// retracted, but it deliberately EXEMPTS search-backed handles — "they carry an island_basis
// and are untouched". That exemption is the hole. `island_basis: 'unique_name_exact'` is not
// island evidence at all: it says "the org's name is distinctive and the handle equals the
// name". That is a statement about the NAME, not about the ISLAND. Under it the pipeline
// shipped an Oklahoma air-ambulance company onto MEDIFLIGHT, an El Paso nail salon onto
// FOREVER NAILS, a Réunion barbershop onto VIANNEY COIFFURE, a Paris boutique onto LE CIVETTE,
// and private individuals' personal Facebook profiles onto named-person orgs.
//
// The gate also has no NEGATIVE-evidence check: a stored profile_title reading
// "Le Civette - Boutique (@lecivette_france) · Paris" was accepted as island presence.
// And SBH-matching on a profile title matches a person's SURNAME — "Anne Lise Barthelemy"
// was read as island presence for the org VANDENHOVE Anne-Lise, a different surname entirely.
//
// Retraction, not deletion: the handle is removed from social_links and the withdrawal plus
// its reason is recorded in metadata.web_discovery.retracted_socials. Rows are never deleted.
//
//   node scripts/concierge/audit-discovered-socials.mjs [--apply]

import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

// Each entry was confirmed by fetching the live page title during the audit (2026-07-20).
// verdict:'retract' removes the handle; verdict:'flag' keeps it but marks it unverified.
const ADJUDICATED = {
  // --- provably a different entity: the live profile names another geography ---
  'MEDIFLIGHT|facebook': ['retract', 'off_island_entity', 'live title "Mediflight Of Oklahoma/Air Methods" — an Oklahoma air-ambulance operator, not the island service'],
  'FOREVER NAILS|facebook': ['retract', 'off_island_entity', 'live title "Forever Nails SPA | El Paso TX"'],
  'VIANNEY COIFFURE|facebook': ['retract', 'off_island_entity', 'live title "Vianney Coiffure | Sainte-Suzanne Réunion" — Indian Ocean, not St Barth'],
  'LE CIVETTE|instagram': ['retract', 'off_island_entity', 'stored profile_title already said "· Paris"; accepted anyway because unique_name_exact never reads negative evidence'],
  'HARTFORD|facebook': ['retract', 'global_brand_account', 'live title "Hartford | Paris" — the maison\'s global account, not the St Barth store; same class as the retracted MONOPRIX/@monoprix'],
  'HARTFORD|instagram': ['retract', 'global_brand_account', '@hartford is the maison\'s global account, not the St Barth store'],
  'HEIKO Poke Bowl Bar|facebook': ['retract', 'global_brand_account', 'live title "Heiko Poké Bowl" — the chain\'s account, not the Gustavia branch'],
  'HEIKO Poke Bowl Bar|instagram': ['retract', 'global_brand_account', 'chain account, not the Gustavia branch'],
  'SAINT-BARTH-BABY-SITTING|facebook': ['retract', 'different_brand', 'live title "Toplipop Halima & Marge"; the org\'s own phone (06 90 41 41 31) does not appear on that brand\'s site'],
  'SAINT-BARTH-BABY-SITTING|instagram': ['retract', 'different_brand', '@luxury_mascots_stbarth is a different business line from this org'],

  // --- wrong person: matched on a surname, and one of them on the ISLAND'S OWN NAME ---
  'VANDENHOVE Anne-Lise|facebook': ['retract', 'wrong_person', 'profile is "Anne Lise Barthelemy" — different surname; passed only because the island-presence regex matched the surname Barthelemy'],
  'PENELOPE SB|facebook': ['retract', 'wrong_person', 'profile is "Penelope Barthélemy" — same surname-as-island false positive'],

  // --- private individuals' personal profiles, name-only match, zero island evidence ---
  'RABAHI Djamel|facebook': ['retract', 'private_profile_unproven', 'a private individual\'s personal profile matched on name alone; the pipeline\'s own held-list shows a comics author of the same name, disproving the "unique name" premise'],
  'CHRIS CLASS|facebook': ['retract', 'private_profile_unproven', 'personal profile, name-only match, no island evidence'],
  'CHRIS CLASS|instagram': ['retract', 'private_profile_unproven', 'personal profile, name-only match, no island evidence'],
  'PETER Laurent|facebook': ['retract', 'private_profile_unproven', 'personal profile, name-only match, no island evidence'],
  'KARINE BRUNEEL|instagram': ['retract', 'private_profile_unproven', 'personal profile, name-only match, no island evidence'],
  'PARIS Noemie|instagram': ['retract', 'private_profile_unproven', 'personal profile, name-only match, no island evidence'],

  // --- no island evidence, entity unproven, but not disproven: keep and mark unverified ---
  'RAMOS CONSTRUCTION|facebook': ['flag', 'one_witness_name_only', 'a US-style "LLC" page with no island evidence'],
  'BLUE STONES|instagram': ['flag', 'one_witness_name_only', '@thebluestones carries no island evidence'],
};

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

const decode = (s) => (s || '').replace(/&#0?39;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"');

const rows = await paged(() => db.from('organizations')
  .select('id,name,social_links,metadata')
  .eq('metadata->>project', 'lofficiel-concierge')
  .not('metadata->web_discovery', 'is', null));

const retractions = [], flags = [];

for (const o of rows) {
  const name = decode(o.name);
  const links = o.social_links || {};
  for (const [net, handle] of Object.entries(links)) {
    if (net.startsWith('_')) continue;
    const hit = ADJUDICATED[`${name}|${net}`];
    if (!hit) continue;
    const [action, verdict, reason] = hit;
    (action === 'retract' ? retractions : flags).push({ o, name, net, handle, verdict, reason });
  }
}

console.error(`\nRETRACT ${retractions.length} handles · FLAG ${flags.length}  (apply=${APPLY})`);
for (const r of retractions) console.error(`  RETRACT ${r.name.slice(0, 30).padEnd(32)} ${r.net}/${String(r.handle).slice(0, 34).padEnd(36)} ${r.verdict}`);
for (const r of flags) console.error(`  FLAG    ${r.name.slice(0, 30).padEnd(32)} ${r.net}/${String(r.handle).slice(0, 34).padEnd(36)} ${r.verdict}`);

if (!APPLY) { console.error('\ndry run — nothing written'); process.exit(0); }

// group by org so one org with two bad handles is a single write
const byOrg = new Map();
for (const r of [...retractions, ...flags]) {
  if (!byOrg.has(r.o.id)) byOrg.set(r.o.id, []);
  byOrg.get(r.o.id).push(r);
}

let dropped = 0, flagged = 0;
for (const [id, items] of byOrg) {
  // re-read immediately before update: never write over something that changed underneath
  const { data: cur, error: readErr } = await db.from('organizations').select('social_links,metadata').eq('id', id).single();
  if (readErr || !cur) { console.error('READ FAIL', id, readErr?.message); continue; }

  const links = { ...(cur.social_links || {}) };
  const removed = {}, marked = {};
  for (const it of items) {
    if (links[it.net] !== it.handle) continue; // changed since adjudication — leave alone
    if (it.verdict && ADJUDICATED[`${it.name}|${it.net}`][0] === 'retract') {
      removed[it.net] = { handle: it.handle, verdict: it.verdict, reason: it.reason };
      delete links[it.net];
    } else {
      marked[it.net] = { handle: it.handle, verdict: it.verdict, reason: it.reason };
    }
  }
  if (!Object.keys(removed).length && !Object.keys(marked).length) continue;

  const wd = { ...(cur.metadata?.web_discovery || {}) };
  if (Object.keys(removed).length) {
    wd.retracted_socials = {
      ...(wd.retracted_socials || {}),
      dropped: removed,
      retracted_at: new Date().toISOString(),
      by: 'scripts/concierge/audit-discovered-socials.mjs',
      note: 'asserted on island_basis=unique_name_exact / profile_title, which prove a NAME match but never island presence; live profile fetch showed a different entity',
    };
  }
  if (Object.keys(marked).length) {
    wd.unverified_socials = { ...(wd.unverified_socials || {}), ...marked, note: 'one-witness, name-only — kept but not authenticated' };
  }

  const stillHas = Object.keys(links).filter((k) => !k.startsWith('_')).length;
  const { error } = await db.from('organizations')
    .update({ social_links: stillHas ? links : {}, metadata: { ...cur.metadata, web_discovery: wd } })
    .eq('id', id);
  if (error) { console.error('WRITE FAIL', id, error.message); continue; }
  dropped += Object.keys(removed).length;
  flagged += Object.keys(marked).length;
}

console.error(`\nretracted ${dropped} handles; flagged ${flagged} as unverified`);
