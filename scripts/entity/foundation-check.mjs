#!/usr/bin/env node
/**
 * foundation-check — ONE runnable command that FAILS (non-zero exit) when a settled
 * L'Officiel-corpus fact regresses.
 *
 * ════════════════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS (the anti-rehash step, 2026-07-20)
 * ════════════════════════════════════════════════════════════════════════════════════
 * In a single day, agents re-derived the same facts three times each: the spine↔page
 * join, the status-lie, the placeholder echo, the presence-axis defect. Every one was
 * already written down in PROSE and enforced by NOTHING. Prose gets skipped because
 * reading ten docs costs more than re-deriving. A finding is only DONE when a future
 * agent CANNOT redo it by accident — when it is an executable check, a registry row, or
 * a column, not a paragraph. This is that check.
 *
 * Read-only. Writes nothing (no INSERT/UPDATE/DELETE, no DDL). Exit 1 on any HARD regression.
 *
 *   Run: cd /Users/skylar/nuke && dotenvx run --quiet -- node scripts/entity/foundation-check.mjs
 *   npm: npm run foundation:check
 *
 * ════════════════════════════════════════════════════════════════════════════════════
 * HARD vs REPORT — and why the split matters
 * ════════════════════════════════════════════════════════════════════════════════════
 * HARD checks are settled STRUCTURAL invariants that only a real regression can break.
 * They exit 1. REPORT checks are measurements that must stay VISIBLE so they are not
 * misread (e.g. "33% extracted" is a scope fact, not a failure) — they print every run
 * and only trip a growth-guard, never a spurious red. A check that ships already-red is
 * noise the next agent learns to ignore, so the split is deliberate and conservative.
 *
 * NB: `npm run spine:validate` intentionally exits 1 today because it treats the ONE
 * unspined publication (lofficiel-stbarth-23, an AMTD print master) as a hard failure —
 * that is an ASPIRATIONAL goal (join everything). foundation-check guards the SETTLED
 * invariant instead (every page INSIDE a spined issue resolves), so stbarth-23 is a
 * reported exception here, not a red. The two checks are different on purpose.
 *
 * ════════════════════════════════════════════════════════════════════════════════════
 * REUSE, not rebuild (.claude/rules/library.md)
 * ════════════════════════════════════════════════════════════════════════════════════
 * The publication→issue_canon key and the page→story resolver are `canonOf()`/`storyFor()`
 * from scripts/entity/mag-spine-join.mjs (built 2026-07-20). They are IMPORTED, never
 * reimplemented. Do not write a second one.
 *
 * ════════════════════════════════════════════════════════════════════════════════════
 * EVERY BASELINE BELOW WAS MEASURED 2026-07-20 against project qkgaybvrernstplzjaam and
 * reproduced through both raw SQL and the PostgREST shapes this script uses.
 * ════════════════════════════════════════════════════════════════════════════════════
 */
import { createClient } from '@supabase/supabase-js';
import { canonOf, storyFor, loadSpine } from './mag-spine-join.mjs';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const MEASURED = '2026-07-20';

// Registry rows, not prose. Each is a fact measured on MEASURED; a live value crossing
// one of these trips a guard. Change a baseline only with a dated reason in the git diff.
const BASELINE = {
  // 40 of 41 L'Officiel PDF publications resolve to a spined issue_canon. The 1 that does
  // not is lofficiel-stbarth-23, an AMTD print master (metadata has no issue_no; canon
  // lofficiel_stbarth:winter:2024 is not in the spine). If this drops, canonOf() broke.
  resolved_lo_pubs_min: 40,
  // completed pages a vision model NEVER read (ai_scan_metadata has no `model` key). All 330
  // carry text from a non-vision path, so they are not the pure status-lie (that is 0, HARD
  // below) — but the population must not GROW, because growth = a new bulk status flip like
  // the 554-page one on 2026-07-14 that made never-read pages permanently invisible.
  no_model_completed_max: 330,
  // column page_type vs spatial_tags->>'page_type' disagreements. This is the adjudication
  // delta (the spine/adjudicator overrode raw vision on 921 pages) — informational, printed
  // so a query against the blob cannot silently return the pre-adjudication answer.
  pagetype_divergence: 921,
};

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
async function headCount(t, build) {
  let q = sb.from(t).select('*', { count: 'exact', head: true });
  if (build) q = build(q);
  const { count, error } = await q;
  if (error) throw new Error(`${t}: ${error.message}`);
  return count;
}

let hardFail = 0;
const lines = [];
const P = (s) => { lines.push(s); };
// defect: one-line statement of what regression this catches. Printed with the verdict so
// the next agent reads WHY, not just WHAT.
function hard(id, ok, value, defect) {
  if (!ok) hardFail++;
  P(`  ${ok ? 'PASS' : 'FAIL'}  [${id}]  ${value}`);
  P(`        defect it prevents: ${defect}  (measured ${MEASURED})`);
}
function report(id, value, defect) {
  P(`  REPORT [${id}]  ${value}`);
  P(`        why it is shown, not asserted: ${defect}  (measured ${MEASURED})`);
}

// ════════════════════════════════════════════════════════════════════════════════════
// LOAD (light: narrow columns only — no heavy spatial_tags/extracted_text blobs pulled)
// ════════════════════════════════════════════════════════════════════════════════════
const { stories, byCanon } = await loadSpine();
const pubs = await pageAll('publications', 'id,slug,metadata', 'id');
const PUB = new Map(pubs.map((p) => [p.id, p]));
const canonByPub = new Map(pubs.map((p) => [p.id, canonOf(p)]));
// `vpt` = spatial_tags->>'page_type' selected as a narrow scalar (NOT the whole blob).
const pages = await pageAll(
  'publication_pages',
  'id,publication_id,page_number,ai_processing_status,page_type,vpt:spatial_tags->>page_type',
  'id',
);

const IS_LO_PDF = (s) => /^lofficiel-(stbarth|riviera)-\d+$/.test(s || '');
const loPubs = pubs.filter((p) => IS_LO_PDF(p.slug));

P(`foundation-check — project ${process.env.VITE_SUPABASE_URL?.match(/\/\/([^.]+)/)?.[1] || '?'}`);
P(`spine ${stories.length} rows / ${byCanon.size} issue canons · ${pages.length} pages · ${pubs.length} publications (${loPubs.length} L'Officiel PDF)\n`);

// ════════════════════════════════════════════════════════════════════════════════════
// [1] JOIN — canonOf() derives a key for the L'Officiel publications, and every page
//     INSIDE a spined issue resolves to a story. 0 orphans inside spined issues.
// ════════════════════════════════════════════════════════════════════════════════════
P('[1] spine↔page join');
const resolvedLo = loPubs.filter((p) => {
  const c = canonByPub.get(p.id);
  return c && byCanon.has(c);
});
const unspinedLo = loPubs.filter((p) => {
  const c = canonByPub.get(p.id);
  return !c || !byCanon.has(c);
});
hard(
  'join.canon-derives',
  resolvedLo.length >= BASELINE.resolved_lo_pubs_min,
  `${resolvedLo.length}/${loPubs.length} L'Officiel PDF publications resolve to a spined canon (baseline >= ${BASELINE.resolved_lo_pubs_min})`,
  'canonOf() stops deriving the issue_canon key from publications.metadata, so pages inherit no story, section, or ad-vs-editorial verdict',
);

// Orphans INSIDE spined issues only — gate on byCanon.has(canon), the settled-invariant scope.
let inStory = 0, orphanInSpined = 0;
const orphanEg = [];
for (const p of pages) {
  const c = canonByPub.get(p.publication_id);
  if (!c || !byCanon.has(c)) continue; // not a spined issue → out of scope for this invariant
  const s = storyFor(p, c, byCanon);
  if (s) inStory++;
  else { orphanInSpined++; if (orphanEg.length < 5) orphanEg.push(`${PUB.get(p.publication_id)?.slug} p${p.page_number}`); }
}
hard(
  'join.no-orphan-in-spined',
  orphanInSpined === 0,
  `${inStory} pages resolve to a story; ${orphanInSpined} orphaned inside a spined issue${orphanEg.length ? ` (e.g. ${orphanEg.join(', ')})` : ''}`,
  'a page inside a known issue falls into no story row — counts computed over pages instead of stories (70% of stories span >1 page)',
);

// ════════════════════════════════════════════════════════════════════════════════════
// [2] CROSS-TITLE — no page resolves to a story from a DIFFERENT issue_canon.
//     (Before the join existed, matching on page_number alone let a Riviera page match a
//      St Barth story. storyFor() only searches within one canon; assert it empirically.)
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[2] cross-title isolation');
let crossTitle = 0;
const crossEg = [];
for (const p of pages) {
  const c = canonByPub.get(p.publication_id);
  if (!c || !byCanon.has(c)) continue;
  const s = storyFor(p, c, byCanon);
  if (s && s.issue_canon !== c) {
    crossTitle++;
    if (crossEg.length < 5) crossEg.push(`${PUB.get(p.publication_id)?.slug} p${p.page_number} -> ${s.issue_canon}`);
  }
}
hard(
  'join.no-cross-title',
  crossTitle === 0,
  `${crossTitle} pages resolve to a story from another issue_canon${crossEg.length ? ` (${crossEg.join('; ')})` : ''}`,
  'a page attaches to a DIFFERENT magazine’s story (Riviera page → St Barth story), silently mislabelling every entity on it',
);

// ════════════════════════════════════════════════════════════════════════════════════
// [3] STATUS LIE — a completed page a model never read AND with nothing to show.
//     The 2026-07-14 bulk `UPDATE ... ai_processing_status='completed'` flipped 554
//     never-read pages to done, making them permanently invisible to the extractor
//     (it selects `pending`). Signature of never-read: ai_scan_metadata has no `model` key.
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[3] status lie (completed but never read)');
const strictLie = await headCount('publication_pages', (q) =>
  q.eq('ai_processing_status', 'completed')
    .filter('ai_scan_metadata->>model', 'is', null)
    .or('extracted_text.is.null,extracted_text.eq.'));
hard(
  'status.no-empty-never-read',
  strictLie === 0,
  `${strictLie} completed pages have NO model scan AND no text (the pure status lie)`,
  'a bulk status flip marks never-read blank pages "completed", hiding them from the extractor forever (554 pages, 2026-07-14)',
);
const noModelCompleted = await headCount('publication_pages', (q) =>
  q.eq('ai_processing_status', 'completed').filter('ai_scan_metadata->>model', 'is', null));
hard(
  'status.no-model-population-flat',
  noModelCompleted <= BASELINE.no_model_completed_max,
  `${noModelCompleted} completed pages were never vision-read (baseline <= ${BASELINE.no_model_completed_max}; these carry text via a non-vision path)`,
  'growth in "completed but no model ran" is the fingerprint of a fresh bulk status flip; a drop is fine (real extraction)',
);

// ════════════════════════════════════════════════════════════════════════════════════
// [4] PLACEHOLDER ECHO — the 7B VLM sometimes returns the schema’s own placeholder
//     ("ALL visible text on the page, verbatim") instead of reading the page. v1 stored it
//     verbatim as extracted_text: fabricated content. cleanRawText() now strips it from
//     extracted_text (the published surface). It legitimately SURVIVES in spatial_tags.raw_text
//     as raw vision testimony (never overwritten) — that is preserved, NOT a defect.
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[4] prompt-placeholder echo');
const echoInText = await headCount('publication_pages', (q) =>
  q.ilike('extracted_text', '%visible text on the page%'));
hard(
  'placeholder.not-in-extracted-text',
  echoInText === 0,
  `${echoInText} pages store the schema placeholder AS extracted_text (was 639 L'Officiel pages)`,
  'the schema’s own placeholder is saved as the page’s content — fabricated text in the published field',
);
const echoInRaw = await headCount('publication_pages', (q) =>
  q.ilike('spatial_tags->>raw_text', '%visible text on the page%'));
report(
  'placeholder.preserved-in-raw-testimony',
  `${echoInRaw} pages keep the placeholder in spatial_tags.raw_text (raw vision testimony)`,
  'this is CORRECT — the blob preserves what the model actually returned; do NOT "clean" it by overwriting testimony',
);

// ════════════════════════════════════════════════════════════════════════════════════
// [5] PAGE_TYPE lives TWICE (the `page_type` column and spatial_tags->>'page_type') and
//     they diverge. The COLUMN is authoritative (ANALYSIS_SPEC): it is what the analysis
//     API and crop/enrich scripts read. Silent divergence is the defect; reporting it loud
//     with a count is the fix. (During the 2026-07-19 repair the blob read 1,122 covers
//     while the column read 63.)
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[5] page_type column vs blob divergence');
let bothDiffer = 0, blobOnly = 0, colOnly = 0;
for (const p of pages) {
  const col = p.page_type ?? null;
  const blob = p.vpt ?? null;
  if (col != null && blob != null && col !== blob) bothDiffer++;
  else if (col == null && blob != null) blobOnly++;
  else if (col != null && blob == null) colOnly++;
}
report(
  'pagetype.divergence',
  `${bothDiffer} pages: column ≠ blob (adjudication delta) · blob-only ${blobOnly} · col-only ${colOnly}`,
  'the column is authoritative; a consumer that reads spatial_tags->>page_type gets the pre-adjudication vision claim (1,122 covers vs 63)',
);
if (blobOnly > 0) {
  hard(
    'pagetype.no-unadjudicated',
    false,
    `${blobOnly} pages carry a raw vision page_type with NO adjudicated column value`,
    'a page has the vision claim but no authoritative verdict — the same UPDATE should write both; extraction wrote the blob and skipped the column',
  );
}

// ════════════════════════════════════════════════════════════════════════════════════
// [6] COVERAGE per title. "33% of the corpus is extracted" is a SCOPE fact, not an
//     extraction failure: the two L'Officiel titles are ~99% done, and nearly all pending
//     pages are other publications (Polo Lifestyles, Spirit of St Barth) that may be out of
//     scope. Reporting the aggregate ALONE is how it got misread as a broken pipeline.
//     Per docs/library/reference/dictionary/progressive-extraction.md: coverage = yield /
//     fillable, never yield / total. For the DISCOVERY pass every page is discovery-fillable,
//     so discovery coverage = completed/total is legitimate; DEPTH layers must use fillable.
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[6] discovery coverage per title (yield / fillable; discovery-fillable = every page)');
const titleOf = (slug) =>
  /^lofficiel-stbarth/.test(slug) ? 'lofficiel-stbarth'
  : /^lofficiel-riviera/.test(slug) ? 'lofficiel-riviera'
  : /^polo/i.test(slug) ? 'polo-lifestyles'
  : /spirit/i.test(slug) ? 'spirit-of-st-barth'
  : 'other';
const cov = new Map();
for (const p of pages) {
  const t = titleOf(PUB.get(p.publication_id)?.slug || '');
  const c = cov.get(t) || { total: 0, done: 0 };
  c.total++;
  if (p.ai_processing_status === 'completed') c.done++;
  cov.set(t, c);
}
let aggTotal = 0, aggDone = 0;
for (const [, c] of cov) { aggTotal += c.total; aggDone += c.done; }
for (const t of [...cov.keys()].sort((a, b) => cov.get(b).total - cov.get(a).total)) {
  const c = cov.get(t);
  P(`        ${t.padEnd(20)} ${String(c.done).padStart(6)} / ${String(c.total).padStart(6)}  = ${(100 * c.done / c.total).toFixed(1)}%`);
}
report(
  'coverage.aggregate-is-scope-not-failure',
  `corpus ${aggDone}/${aggTotal} = ${(100 * aggDone / aggTotal).toFixed(0)}% — but lofficiel-stbarth ${(100 * (cov.get('lofficiel-stbarth')?.done || 0) / (cov.get('lofficiel-stbarth')?.total || 1)).toFixed(0)}% & lofficiel-riviera ${(100 * (cov.get('lofficiel-riviera')?.done || 0) / (cov.get('lofficiel-riviera')?.total || 1)).toFixed(0)}%`,
  'quoting the aggregate alone reads a scope decision (which titles we chose to process) as an extraction failure',
);

// ════════════════════════════════════════════════════════════════════════════════════
// [7] NO AXIS DEFINED AS "IS NOT NULL". ax_mark was `logo_url IS NOT NULL` and scored 306+
//     villas wearing a borrowed agency favicon (a shared mark binary) as authenticated. The
//     concrete fix is the additive `metadata.mark_quarantine` flag: presence is NOT
//     authentication. Any axis defined as mere presence is inflated by the quarantined count.
//     (This check guards the KNOWN presence-axis; a NEW axis defined as IS NOT NULL must be
//      added here so it, too, cannot be scored silently.)
// ════════════════════════════════════════════════════════════════════════════════════
P('\n[7] presence ≠ authentication (ax_mark)');
let logoPresent = 0, borrowed = 0;
try {
  logoPresent = await headCount('organizations', (q) =>
    q.eq('metadata->>project', 'lofficiel-concierge').not('logo_url', 'is', null));
  borrowed = await headCount('organizations', (q) =>
    q.eq('metadata->>project', 'lofficiel-concierge')
      .not('logo_url', 'is', null)
      .not('metadata->mark_quarantine', 'is', null));
  const honest = logoPresent - borrowed;
  report(
    'axis.mark-presence-is-not-authentication',
    `ax_mark as "logo_url IS NOT NULL" counts ${logoPresent}; ${borrowed} wear a borrowed/quarantined mark → honest authenticated = ${honest}`,
    'defining an axis as mere presence scores a borrowed agency favicon as a captured mark; subtract mark_quarantine before any authentication metric',
  );
} catch (e) {
  report('axis.mark-presence-is-not-authentication', `organizations axis not measurable in this env (${e.message})`,
    'presence must never be read as authentication; re-check when the concierge org set is present');
}

// ════════════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════════════
P('\n' + '─'.repeat(80));
if (unspinedLo.length) {
  P(`note: ${unspinedLo.length} L'Officiel PDF publication(s) do not join a spined issue — ${unspinedLo.map((p) => p.slug).join(', ')}`);
  P('      (lofficiel-stbarth-23 is an AMTD print master, not an unspined issue — SPINE_PROPOSALS.md). Reported, not failed.');
}
console.log(lines.join('\n'));
console.log(`\n${hardFail ? `${hardFail} HARD FAILURE(S) — a settled fact regressed` : 'all HARD checks passed — no settled fact has regressed'}`);
process.exit(hardFail ? 1 : 0);
