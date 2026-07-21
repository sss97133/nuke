#!/usr/bin/env node
// Record the NEGATIVE result of a web-discovery sweep.
//
// THE FRAME: "when data is absent, it must surface MEASURED AS ABSENT — never a clean-
// looking lie." An org that was swept and genuinely has no web presence must be
// distinguishable from an org nobody ever looked at. Without this, absence is invisible
// and the next agent burns the same credits to learn the same nothing.
//
// Consumes the report emitted by discover-org-websites.mjs — no new network calls.
//   node scripts/concierge/record-web-absence.mjs <report.json> [--apply]

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const APPLY = process.argv.includes('--apply');

const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
  .filter((r) => !r.website && !Object.keys(r.socials || {}).length);

console.error(`orgs swept with no web presence found: ${rows.length} (apply=${APPLY})`);
let written = 0, skipped = 0;

for (const r of rows) {
  const block = {
    observed_at: r.observed_at,
    method: 'overpass+firecrawl_search+entity_gate',
    script: 'scripts/concierge/discover-org-websites.mjs',
    outcome: 'absent',
    // what was actually done, so this is a measurement and not an assertion
    searched: r.searched ?? 0,
    search_error: r.error || null,
    website: null,
    socials: null,
    // every URL considered and the reason it failed the gate — the audit trail behind the NULL
    rejected: (r.held || []).map((h) => ({ url: h.url, verdict: h.verdict, reason: h.reason })),
    trust: null,
    confidence: r.error ? 0.3 : r.searched ? 0.8 : 0.5,
    note: r.error
      ? 'sweep errored — absence NOT established, re-run this org'
      : r.searched
        ? 'searched and gated; no page on the open web both identifies this org and clears the discovery bar'
        : 'search returned no results at all',
  };
  if (!APPLY) { skipped++; continue; }
  const { data: cur, error } = await db.from('organizations').select('metadata, enrichment_sources').eq('id', r.id).single();
  if (error) { console.error('READ FAIL', r.name, error.message); continue; }
  const srcs = new Set(cur.enrichment_sources || []); srcs.add('web-discovery');
  const { error: e } = await db.from('organizations').update({
    metadata: { ...(cur.metadata || {}), web_discovery: block },
    enrichment_sources: [...srcs],
    last_enriched_at: r.observed_at,
    // enrichment_status stays 'stub' — nothing was enriched. The sweep is recorded in
    // metadata.web_discovery; claiming 'enriched' for an empty result would be the lie.
  }).eq('id', r.id);
  if (e) console.error('WRITE FAIL', r.name, e.message); else written++;
  if (written % 100 === 0 && written) console.error(`  ${written}/${rows.length}`);
}
console.error(APPLY ? `absence recorded on ${written} orgs` : `dry run — ${skipped} would be recorded`);
