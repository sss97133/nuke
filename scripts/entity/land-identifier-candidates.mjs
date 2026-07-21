#!/usr/bin/env node
// scripts/entity/land-identifier-candidates.mjs — the LANDING step of the
// identifier pass (progressive-extraction.md ladder).
//
// identifier-pass.mjs ran 2026-07-20 15:09 and staged 6,563 candidate
// page->org links in output/identifier-pass-candidates.ndjson. By design it
// wrote nothing. This script is the downstream grader it stages for: it
// grades every candidate DETERMINISTICALLY (no model — the tier stays
// hallucination-survivable) and lands the graded ones as publication_features
// witnesses, mirroring the hand-landed Gumbs rows of 2026-07-20 field for
// field (confidence NULL — never invented; provenance in details).
//
// GRADES (rule: a cheap pass never overwrites an expensive one — inserts only,
// and never a second witness for an (org, publication, page) that has one):
//   hold_ambiguous     identifier_shared_by_n_orgs > 1  -> NOT landed (ledgered)
//   directory_page     org_count_on_page >= 6           -> feature_kind 'directory_listing'
//   unique_identifier  otherwise                        -> feature_kind by page_type
//                      (ad/advertisement -> 'ad'; editorial/photo_spread ->
//                       'editorial'; else 'identifier_match')
//
// USAGE (from /Users/skylar/nuke):
//   dotenvx run --quiet -- node scripts/entity/land-identifier-candidates.mjs           # dry-run
//   dotenvx run --quiet -- node scripts/entity/land-identifier-candidates.mjs --apply
//
// Idempotent: existing (org_id, publication_id, page) triples are skipped, so
// a re-run lands nothing new. Run ledger -> output/identifier-landing-<date>.json
// (rule 1: record what was looked for, not only what was found).

import fs from 'node:fs';
import readline from 'node:readline';
import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');
const LANDED_BY = 'land-identifier-candidates-2026-07-21';
const IN = 'output/identifier-pass-candidates.ndjson';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  global: { headers: { 'X-Nuke-Writer': 'scripts/entity/land-identifier-candidates.mjs' } },
});

const kindFor = (pageType) => {
  const t = String(pageType ?? '').toLowerCase();
  if (t.includes('ad')) return 'ad';
  if (t === 'editorial' || t === 'photo_spread') return 'editorial';
  return 'identifier_match';
};

async function main() {
  // Existing witnesses — never land a second one for the same triple.
  const existing = new Set();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('publication_features')
      .select('org_id, publication_id, page').range(from, from + 999);
    if (error) throw new Error(`preload: ${error.message}`);
    for (const r of data) existing.add(`${r.org_id}|${r.publication_id}|${r.page}`);
    if (data.length < 1000) break;
  }

  // Paged — 1,077 publications and PostgREST caps at 1,000 (the exact silent-
  // truncation class that broke the island map on 2026-07-18).
  const slugOf = {};
  for (let from = 0; ; from += 1000) {
    const { data, error } = await db.from('publications').select('id, slug').range(from, from + 999);
    if (error) throw new Error(`pubs: ${error.message}`);
    for (const p of data) slugOf[p.id] = p.slug;
    if (data.length < 1000) break;
  }

  // Collapse candidates to one row per (org, publication, page); a page that
  // matched by phone AND domain is one witness carrying both identifiers.
  const byTriple = new Map();
  const ledger = { read: 0, hold_ambiguous: 0, skip_existing: 0, land_unique: 0, land_directory: 0 };
  const rl = readline.createInterface({ input: fs.createReadStream(IN) });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const c = JSON.parse(line);
    ledger.read++;
    if ((c.identifier_shared_by_n_orgs ?? 1) > 1) { ledger.hold_ambiguous++; continue; }
    const key = `${c.org_id}|${c.publication_id}|${c.page_number}`;
    if (existing.has(key)) { ledger.skip_existing++; continue; }
    const grade = (c.org_count_on_page ?? 1) >= 6 ? 'directory_page' : 'unique_identifier';
    const cur = byTriple.get(key);
    if (cur) {
      cur.details.identifiers.push({ type: c.identifier_type, value: c.matched_value });
      continue;
    }
    byTriple.set(key, {
      org_id: c.org_id,
      publication_id: c.publication_id,
      publication: slugOf[c.publication_id] ?? null,
      page: c.page_number,
      org_name_printed: c.org_name ?? null,
      feature_kind: grade === 'directory_page' ? 'directory_listing' : kindFor(c.page_type_column ?? c.page_type_from_tags),
      source_url: `identifier_pass:${c.identifier_type}`,
      confidence: null,   // never invented (the Gumbs rule)
      details: {
        landed_by: LANDED_BY,
        grade,
        identifier_type: c.identifier_type,
        matched_value: c.matched_value,
        identifiers: [{ type: c.identifier_type, value: c.matched_value }],
        evidence: String(c.evidence_snippet ?? '').slice(0, 240),
        page_type: c.page_type_column ?? c.page_type_from_tags ?? null,
        org_count_on_page: c.org_count_on_page ?? null,
        identifier_shared_by_n_orgs: c.identifier_shared_by_n_orgs ?? null,
        reader_url: c.source_url ?? null,
      },
      _grade: grade,
    });
  }

  const rows = [...byTriple.values()];

  // category is NOT NULL on publication_features. It comes from the org's own
  // recorded category (supply view, then organizations.metadata.kind) — never
  // invented; 'unknown' when the substrate holds none.
  const orgIds = [...new Set(rows.map((r) => r.org_id))];
  const orgCat = {};
  const orgName = {};
  for (let i = 0; i < orgIds.length; i += 200) {
    const slice = orgIds.slice(i, i + 200);
    const [{ data: sup }, { data: orgs }] = await Promise.all([
      db.from('concierge_supply_stbarth').select('org_id, concierge_category').in('org_id', slice),
      db.from('organizations').select('id, name, metadata').in('id', slice),
    ]);
    for (const o of orgs ?? []) { orgCat[o.id] = o.metadata?.kind ?? orgCat[o.id]; orgName[o.id] = o.name; }
    for (const s of sup ?? []) orgCat[s.org_id] = s.concierge_category ?? orgCat[s.org_id];
  }
  for (const r of rows) {
    r.category = orgCat[r.org_id] ?? 'unknown';
    // org_name_printed is NOT NULL; when the pass carried no printed name the
    // registered name labels the row and details.evidence holds the printed truth.
    r.org_name_printed = r.org_name_printed ?? orgName[r.org_id] ?? r.details.matched_value;
  }

  for (const r of rows) {
    if (r._grade === 'directory_page') ledger.land_directory++;
    else ledger.land_unique++;
    r.details.identifiers = r.details.identifiers ?? [];
    delete r._grade;
  }

  console.log(`${APPLY ? 'APPLY' : 'DRY-RUN'} — ${JSON.stringify(ledger)} -> ${rows.length} rows to land`);

  if (APPLY && rows.length) {
    let landed = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const batch = rows.slice(i, i + 500);
      const { error } = await db.from('publication_features').insert(batch);
      if (error) throw new Error(`insert batch ${i}: ${error.message}`);
      landed += batch.length;
      process.stdout.write(`  landed ${landed}/${rows.length}\r`);
    }
    console.log(`\nlanded ${landed} witnesses`);
  }

  const out = `output/identifier-landing-${new Date().toISOString().slice(0, 10)}.json`;
  fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), apply: APPLY, ledger, rows_prepared: rows.length }, null, 2));
  console.log(`ledger -> ${out}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
