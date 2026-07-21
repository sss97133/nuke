#!/usr/bin/env node
/**
 * mag-spine-validate.mjs — the EXECUTABLE CHECK that stops the spine from being re-derived.
 *
 * Context (measured 2026-07-20, do not re-derive — run this instead):
 *   The L'Officiel story spine is NOT missing. `mag_stories` holds 432 rows over 15 issue canons,
 *   and those 15 canons ARE every distinct L'Officiel issue that has pages in the corpus.
 *   The "15 of 41 issues spined" figure that motivated a spine-extension effort counted
 *   PUBLICATION ROWS, not issues: 41 publications = 15 issues x cover variants. Verified by phash:
 *   lofficiel-stbarth-24 and -25 are 133/134 page-identical to -07 at offset 0 (they differ only
 *   on the cover), and -06 is 91/132 identical to -05.
 *
 *   Every page inside a canon-derivable L'Officiel publication already resolves to a story:
 *   5,316 in-story, 0 orphans. The only unresolved L'Officiel pages (554) belong to four
 *   publications whose `metadata` lacks a `brand` key, so `canonOf()` correctly refuses.
 *   That is a JOIN gap, not a spine gap. See PROPOSAL-spine-join-metadata.md.
 *
 * WHAT THIS CHECKS
 *   1. join      — every L'Officiel publication resolves to a canon, and that canon is spined.
 *   2. coverage  — every page of a spined issue falls inside exactly one spine row, no gaps,
 *                  no overlaps, spine max page == publication page count.
 *   3. evidence  — each story's printed title actually appears in the page text somewhere inside
 *                  its own [page_start, page_end]. A title found ONLY outside its range is a
 *                  real disagreement between the printed TOC and the pages, and is REPORTED,
 *                  never silently corrected.
 *
 * Appearances of a title on a toc/masthead/edito page are expected (that is what a TOC is) and
 * are not drift. This distinction is the whole reason a naive title-match reports 60 false drifts.
 *
 * Read-only. Writes nothing. Exit 1 if any hard check fails.
 *
 * Usage: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/mag-spine-validate.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { canonOf, storyFor, loadSpine } from './mag-spine-join.mjs';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// PostgREST caps at 1000 rows and silently clamps larger limits — always paginate.
async function pageAll(t, sel, ord, f) {
  let o = [], i = 0;
  for (;;) {
    let q = sb.from(t).select(sel).order(ord).range(i, i + 999);
    if (f) q = f(q);
    const { data, error } = await q;
    if (error) throw new Error(`${t}: ${error.message}`);
    if (!data?.length) break;
    o.push(...data);
    if (data.length < 1000) break;
    i += 1000;
  }
  return o;
}

const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const IS_LO_PDF = s => /^lofficiel-(stbarth|riviera)-\d+$/.test(s || '');

let fail = 0;
const bad = (m) => { fail++; console.log(`  FAIL ${m}`); };

const { stories, byCanon } = await loadSpine();
const pubs = (await pageAll('publications', 'id,slug,metadata', 'id')).filter(p => IS_LO_PDF(p.slug));
const pages = await pageAll('publication_pages', 'id,publication_id,page_number,extracted_text', 'id');
const byPub = new Map();
for (const p of pages) {
  if (!byPub.has(p.publication_id)) byPub.set(p.publication_id, []);
  byPub.get(p.publication_id).push(p);
}

console.log(`spine: ${stories.length} rows / ${byCanon.size} issue canons`);
console.log(`L'Officiel PDF publications: ${pubs.length}\n`);

console.log('[1] join');
const canonOfPub = new Map();
for (const p of pubs) {
  const c = canonOf(p);
  canonOfPub.set(p.id, c);
  if (!c) bad(`${p.slug}: no derivable canon (metadata keys: ${Object.keys(p.metadata || {}).join(',') || 'none'})`);
  else if (!byCanon.has(c)) bad(`${p.slug}: canon ${c} has no spine rows`);
}
const resolved = pubs.filter(p => canonOfPub.get(p.id) && byCanon.has(canonOfPub.get(p.id)));
console.log(`  ${resolved.length}/${pubs.length} publications join to a spined issue`);
console.log(`  distinct issues covered: ${new Set(resolved.map(p => canonOfPub.get(p.id))).size}`);

console.log('\n[2] coverage');
let inStory = 0, orphan = 0;
for (const p of resolved) {
  const canon = canonOfPub.get(p.id);
  const rows = [...byCanon.get(canon)].sort((a, b) => a.page_start - b.page_start);
  const pp = byPub.get(p.id) || [];
  for (const pg of pp) (storyFor(pg, canon, byCanon) ? inStory++ : (orphan++, bad(`${p.slug} p${pg.page_number}: no spine row`)));
  const max = Math.max(...rows.map(r => r.page_end ?? r.page_start));
  if (max !== pp.length) bad(`${p.slug}: ${pp.length} pages but spine ends at ${max} (${canon})`);
  let cur = 0;
  for (const r of rows) {
    if (r.page_start <= cur) bad(`${canon}: overlap at p${r.page_start} ("${r.title}")`);
    if (r.page_start > cur + 1) bad(`${canon}: gap pp.${cur + 1}-${r.page_start - 1}`);
    cur = Math.max(cur, r.page_end ?? r.page_start);
  }
}
console.log(`  pages resolving to a story: ${inStory}, orphans: ${orphan}`);

console.log('\n[3] title evidence (disagreements are reported, not corrected)');
const NON_STORY = new Set(['toc', 'masthead', 'edito', 'cover']);
let checked = 0, absent = 0, outside = 0;
// One representative publication per canon — cover variants share an interior (phash-verified),
// so checking each of them would report the same finding several times.
const seenCanon = new Set();
for (const p of resolved) {
  const canon = canonOfPub.get(p.id);
  if (seenCanon.has(canon)) continue;
  seenCanon.add(canon);
  const rows = byCanon.get(canon);
  const txt = new Map((byPub.get(p.id) || []).map(r => [r.page_number, norm(r.extracted_text)]));
  // pages belonging to a non-story spine row are legitimate places for any title to appear
  const refPages = new Set();
  for (const r of rows) if (NON_STORY.has(r.kind)) for (let n = r.page_start; n <= (r.page_end ?? r.page_start); n++) refPages.add(n);
  for (const s of rows) {
    if (s.kind !== 'story' || !s.title) continue;
    const t = norm(s.title);
    if (t.length < 8) continue;           // short titles false-match; not evidence either way
    checked++;
    const hits = [...txt.entries()].filter(([, v]) => v.includes(t)).map(([n]) => n);
    const inRange = hits.some(n => n >= s.page_start && n <= (s.page_end ?? s.page_start));
    if (inRange) continue;
    const elsewhere = hits.filter(n => !refPages.has(n));
    if (!hits.length) { absent++; console.log(`  ABSENT   ${canon} pp.${s.page_start}-${s.page_end} "${s.title}" — title text on no page (photo-led story, or a TOC label that is not printed on the opener)`); }
    else if (!elsewhere.length) { absent++; console.log(`  TOC-ONLY ${canon} pp.${s.page_start}-${s.page_end} "${s.title}" — appears only on toc/masthead p${hits.join(',')}`); }
    else { outside++; console.log(`  DISAGREE ${canon} pp.${s.page_start}-${s.page_end} "${s.title}" — printed on p${elsewhere.join(',')}, outside its spine range`); }
  }
}
console.log(`  story titles checked: ${checked}; no in-range evidence: ${absent}; printed outside range: ${outside}`);

console.log(`\n${fail ? `${fail} HARD FAILURE(S)` : 'all hard checks passed'}`);
process.exit(fail ? 1 : 0);
