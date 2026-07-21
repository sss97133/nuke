#!/usr/bin/env node
/**
 * folio-extract — recover the PRINTED folio for a magazine page. Read-only.
 *
 * THE GAP, measured 2026-07-20. `publication_pages.page_number` is the PDF index. The number
 * printed on the paper — the folio — exists in NO column. Consequence: "the table of contents
 * says page 84" can never be checked against any row, so the magazine cannot audit itself, and
 * every citation that quotes a printed page is unverifiable. `mag_stories.source_note` already
 * records the folio for spined issues, but only as free text ("Folio 47; La Pointe.").
 *
 * WHY NOT A MODEL. A wrong folio silently misfiles every citation on that page — it is worse
 * than a missing one, because it looks answered. So nothing here guesses. Two evidence sources
 * are read verbatim and one arithmetic relation is fitted:
 *
 *   printed_folio = page_number + offset       (offset is constant across a run of pages)
 *
 * SOURCES — two, and they are INDEPENDENT, which is what makes the accuracy number mean anything
 *   spine  (T2 printed) — a folio quoted in mag_stories.source_note, read off the printed TOC by
 *                         a strong model. 329 of 432 spine rows carry one. See
 *                         folioFromSourceNote() for the three note shapes and which are evidence.
 *   text   (T4 vision)  — an ISOLATED integer line in publication_pages.extracted_text, the
 *                         shape a folio takes in OCR, from a 7B discovery sweep that never saw
 *                         the spine. Rejected on any page showing more than one (a TOC is a list
 *                         of folios, not a folio) and on page types that are lists by nature.
 *
 * THE FIT VALIDATES ITSELF — see bracket() for the arithmetic proof. Two observations agreeing
 * on one offset FORCE the folio of every page between them; there is no room for an unnumbered
 * leaf. An observation that brackets with neither neighbour is a SEQUENCE BREAK: a finding, not
 * noise. Breaks are classified (see the switch in derive()) because "the spine's opener is one
 * page off" and "a foldout was bound in here" are different facts. A T4 break (`break_text` — an
 * OCR isolated integer with no corroboration) is NEVER staged; it goes to eyes, because an
 * uncorroborated OCR number is as likely to be ad copy ("15 YEARS", "50 - a retrospective") as a
 * folio, and a wrong folio is worse than a missing one. A T2 break (`break_printed` /
 * `opener_off_by_one` — the magazine's OWN printed number, read off the TOC) IS staged as a fact
 * about its own page, unbracketed flag set.
 *
 * MEASURED HOLDOUT, 2026-07-20 (`--validate`, reproducible): build the folio map from the SPINE
 * ALONE, then score the OCR integers against it. 76 OCR readings land on a covered page;
 * 68 agree — 89.5%. All 4 gross misses are small integers that were never folios (OCR read 3,
 * 10, 29, 29 against derived 92, 43, 71, 71); on readings within +/-2 the rate is 68/72 = 94.4%.
 * The residual 4 are off-by-one, and there the OCR is probably right and the spine's page_start
 * approximate — several such spine notes say "opener approximate" in their own words. That
 * question is raised in the proposal, not silently decided here.
 *
 * TRUST, per docs/ANALYSIS_SPEC.md precedence T1 > T2 > T3 > T4:
 *   observed_printed  T2  spine note read off the printed page
 *   observed_text     T4  isolated integer in OCR
 *   derived_offset    T2/T4  page lies BETWEEN two agreeing observations — interpolation, exact
 *   extrapolated      T4  page outside every observed span, issue has ONE confirmed offset and
 *                         zero real breaks. Staged in a SEPARATE bucket. Weakest thing here.
 *
 * NO SCHEMA CHANGE. There is no `printed_folio` column and this script does not create one.
 * It writes a staging file only. The column is PROPOSED, with this run's evidence, in
 *   docs/architecture/FOLIO_COLUMN_PROPOSAL.md
 * and lands the moment an owner signs off.
 *
 * REUSE, not rebuild (.claude/rules/library.md): the publication -> issue_canon key is
 * `canonOf()` from scripts/entity/mag-spine-join.mjs, built 2026-07-20. It is imported, not
 * reimplemented. Do not write a second one.
 *
 * Usage:
 *   node scripts/entity/folio-extract.mjs                  report + write staging file
 *   node scripts/entity/folio-extract.mjs --scope all      every publication, not just L'Officiel
 *   node scripts/entity/folio-extract.mjs --issue <slug>   one publication, verbose
 *   node scripts/entity/folio-extract.mjs --validate       HOLDOUT: score OCR folios against a
 *                                                          map built from the spine alone.
 *   node scripts/entity/folio-extract.mjs --check          re-derive and DIFF against the staged
 *                                                          file; exit 1 if a staged folio MOVED.
 *
 * `npm run folio:extract` / `folio:validate` / `folio:check`.
 *
 * --check is the executable check, and it is the point. This work was done because prose gets
 * skipped and re-derived: the org piles, the entity gate, the observation grammar and the
 * two-pass model were each re-derived in one day off documents that described them correctly.
 * A paragraph saying "folios are already recovered" would be skipped too. A command that exits
 * non-zero is not. If you are about to write a folio extractor: run --check first.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
// canonOf is the publication -> issue_canon key built 2026-07-20. Imported, never reimplemented.
// loadSpine() is NOT used: its select list omits `source_note`, which is the only place a printed
// folio is recorded. Reading mag_stories directly here rather than widening a shared loader that
// other callers depend on.
import { canonOf } from './mag-spine-join.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../..');
const STAGE = resolve(REPO, 'output/folio/folio-staging.json');

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// ---------------------------------------------------------------- tunables, all stated

/** A folio outside this distance from the PDF index is not a folio. Front matter in these
 *  books runs 2-25 unnumbered leaves; 80 is generous and still excludes phone numbers,
 *  years and prices that survived the isolated-line filter. */
const MAX_OFFSET = 80;

/** Page types that are LISTS of folios, never bearers of one. A TOC page printing "34 44 78"
 *  is the single most dangerous false positive available: it would fit an offset from another
 *  page's number. */
const LIST_TYPES = new Set(['table_of_contents', 'directory', 'masthead', 'index', 'contents']);

/** Segment confirmation threshold. Two agreeing observations. One is a coincidence. */
const MIN_SEGMENT_OBS = 2;

// ---------------------------------------------------------------- io

async function pageAll(table, select, order, filt = q => q) {
  // PostgREST caps at 1000 and silently clamps larger limits — paginate on a stable order.
  const out = [];
  for (let i = 0; ; i += 1000) {
    const { data, error } = await filt(sb.from(table).select(select)).order(order).range(i, i + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

// ---------------------------------------------------------------- evidence readers

/**
 * The folio a spine row states in prose. Quote, never infer.
 *
 * Three note shapes exist in the 329 folio-bearing rows (counted 2026-07-20), and only two of
 * them are evidence:
 *
 *   anchor  13 rows  "Ad. Editor's Letter folio 14=PDF16 (offset ~+2)"
 *                    An EXPLICIT (folio, pdf-index) pair. The strongest evidence in the corpus,
 *                    and it does NOT belong to this story's page_start — it names its own page.
 *   plain  304 rows  "Folio 47; La Pointe."  -> this story's page_start carries folio 47.
 *   range   12 rows  "Printed contents, part 1 (folios 18-62), PDF p22."
 *                    A TOC LISTING other pages' folios. Binding 18 to p22 would have injected a
 *                    +40 phantom offset into six issues — this exact false positive was produced
 *                    and caught on the first run. REJECTED.
 *
 * Returns {folio, page_number|null, shape} or null. page_number non-null means the note named
 * its own page and the caller must NOT fall back to page_start.
 */
export function folioFromSourceNote(note) {
  const s = note || '';
  const anchor = /\bfolio\s+(\d{1,3})\s*=\s*PDF\s*p?\.?\s*(\d{1,3})\b/i.exec(s);
  if (anchor) {
    const f = Number(anchor[1]), p = Number(anchor[2]);
    if (f >= 1 && f <= 999 && p >= 1 && p <= 999) return { folio: f, page_number: p, shape: 'anchor' };
  }
  // A plural folio followed by a dash is a RANGE this page merely lists. Not its own folio.
  if (/\bfolios\s+\d{1,3}\s*[-–—]/i.test(s)) return null;
  const m = /\bfolio\s+(\d{1,3})\b/i.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  if (n < 1 || n > 999) return null;
  return { folio: n, page_number: null, shape: 'plain' };
}

/**
 * The folio printed on this page as read from its OCR text, or null.
 * An isolated integer line, and EXACTLY one of them. Ambiguity returns null, never a pick:
 * choosing among candidates is guessing, and this file exists because guessing misfiles
 * citations. Returns {folio, evidence} or null.
 */
export function folioFromPageText(text, pageType) {
  if (LIST_TYPES.has(String(pageType || '').toLowerCase())) return null;
  if (!text || !text.trim()) return null;
  const lines = text.split('\n').map(s => s.trim()).filter(Boolean);
  const hits = new Set();
  let raw = null;
  for (const line of lines) {
    // A hashtag is not a folio. "#LOFFICIEL100" matched the running-head shape on 4 Riviera
    // pages in the first run and produced a bogus +69 offset. Reject the whole line.
    if (line.startsWith('#')) continue;
    // bare folio: "84"
    let m = /^(\d{1,3})$/.exec(line);
    // folio beside a running head: "84 L'OFFICIEL" / "L'OFFICIEL 84"
    if (!m) m = /^(\d{1,3})\s*[|·\-–—]?\s*L['’]?OFFICIEL\b/i.exec(line);
    if (!m) m = /\bL['’]?OFFICIEL\s*[|·\-–—]?\s*(\d{1,3})\s*$/i.exec(line);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 999) continue;
    hits.add(n);
    raw = line;
  }
  if (hits.size !== 1) return null;         // 0 = nothing printed / OCR dropped it; >1 = a list
  return { folio: [...hits][0], evidence: raw };
}

// ---------------------------------------------------------------- the fit

/**
 * Bracket an issue's observations into confirmed spans.
 *
 * THE ARITHMETIC, and why this is recovery and not inference. Take two observations on the same
 * issue, pages A and B (A < B), whose folios differ by exactly B - A. Then every page strictly
 * between them is numbered, and its folio is forced: folios are consecutive integers, so
 * (B - A) pages of travel producing (folio_B - folio_A) = (B - A) of folio travel leaves no room
 * for an unnumbered leaf. The folio of any page in [A, B] is page + offset. That is a proof, not
 * a guess, and it is why no model is invoked anywhere in this file.
 *
 * ADJACENT PAIRS, not runs. An earlier version cut runs of same-offset observations, which let a
 * single bad reading shatter a good issue into singletons — pp.24,26,27,28 at offsets -2,-3,-2,-2
 * yielded three "breaks" and one span. Bracketing adjacent pairs instead confines the damage to
 * the bad reading's own neighbourhood: (27,28) and (28,40) still bracket, and only p.26 is
 * reported. Same evidence, far more recovered, and the finding is sharper.
 *
 * obs: [{page_number, folio, ...}] deduped per page. Returns {brackets, unbracketed}.
 */
export function bracket(obs) {
  const sorted = [...obs].sort((a, b) => a.page_number - b.page_number);
  const brackets = [];
  const used = new Set();
  for (let i = 0; i + 1 < sorted.length; i++) {
    const a = sorted[i], b = sorted[i + 1];
    if (a.folio - a.page_number !== b.folio - b.page_number) continue;
    brackets.push({
      offset: a.folio - a.page_number,
      page_first: a.page_number, page_last: b.page_number,
      obs: [a, b],
    });
    used.add(a.page_number); used.add(b.page_number);
  }
  // Merge brackets that chain (b's right edge is c's left edge) so spans read as one finding.
  const merged = [];
  for (const br of brackets) {
    const last = merged[merged.length - 1];
    if (last && last.offset === br.offset && last.page_last === br.page_first) {
      last.page_last = br.page_last;
      last.obs.push(br.obs[1]);
    } else merged.push({ ...br, obs: [...br.obs] });
  }
  return { brackets: merged, unbracketed: sorted.filter(o => !used.has(o.page_number)) };
}

// ---------------------------------------------------------------- main derivation

async function derive({ scope = 'lofficiel', only = null, textEvidence = true } = {}) {
  const stories = await pageAll('mag_stories', 'id,issue_canon,kind,title,page_start,page_end,source_note,source_tier', 'id');
  const pubs = await pageAll('publications', 'id,slug,title,metadata', 'id');

  const inScope = pubs.filter(p => {
    if (only) return p.slug === only;
    if (scope === 'all') return true;
    return /^lofficiel-(stbarth|riviera)/.test(p.slug || '');
  });

  // spine folios, indexed by canon
  const spineByCanon = new Map();
  let spineRejected = 0;
  for (const s of stories) {
    const hit = folioFromSourceNote(s.source_note);
    if (!hit) { if (/folio/i.test(s.source_note || '')) spineRejected++; continue; }
    // An anchor names its own PDF page. A plain note describes the story's first page.
    const pn = hit.page_number ?? s.page_start;
    if (pn == null) continue;
    if (!spineByCanon.has(s.issue_canon)) spineByCanon.set(s.issue_canon, []);
    spineByCanon.get(s.issue_canon).push({
      page_number: pn, folio: hit.folio, shape: hit.shape, story_id: s.id, note: s.source_note,
    });
  }
  // Anchors last so they win the per-page dedupe below.
  for (const arr of spineByCanon.values()) arr.sort((a, b) => (a.shape === 'anchor' ? 1 : 0) - (b.shape === 'anchor' ? 1 : 0));

  const issues = [];
  let totalPages = 0;

  for (const pub of inScope) {
    const pages = await pageAll(
      'publication_pages', 'id,publication_id,page_number,page_type,extracted_text', 'page_number',
      q => q.eq('publication_id', pub.id)
    );
    if (!pages.length) continue;
    totalPages += pages.length;

    const canon = canonOf(pub);

    // --- collect observations, one per page, spine (T2) beating text (T4) on conflict
    const byPage = new Map();
    const conflicts = [];
    const rejected = [];

    const textObs = [];
    for (const p of pages) {
      const hit = folioFromPageText(p.extracted_text, p.page_type);
      if (!hit) continue;
      textObs.push({ page_id: p.id, page_number: p.page_number, folio: hit.folio });
      if (!textEvidence) continue;   // --validate holds these out to score the method
      if (Math.abs(hit.folio - p.page_number) > MAX_OFFSET) {
        rejected.push({ page_number: p.page_number, folio: hit.folio, why: 'offset_beyond_bound' });
        continue;
      }
      byPage.set(p.page_number, {
        page_number: p.page_number, folio: hit.folio,
        source: 'observed_text', tier: 'T4', evidence: hit.evidence,
      });
    }

    for (const s of (canon ? spineByCanon.get(canon) || [] : [])) {
      if (Math.abs(s.folio - s.page_number) > MAX_OFFSET) {
        rejected.push({ page_number: s.page_number, folio: s.folio, why: 'offset_beyond_bound' });
        continue;
      }
      const prior = byPage.get(s.page_number);
      if (prior && prior.folio !== s.folio) {
        conflicts.push({ page_number: s.page_number, text: prior.folio, spine: s.folio });
      }
      byPage.set(s.page_number, {           // T2 > T4, always
        page_number: s.page_number, folio: s.folio,
        source: 'observed_printed', tier: 'T2', shape: s.shape,
        evidence: s.note,
        corroborated_by_text: prior ? prior.folio === s.folio : false,
      });
    }

    const obs = [...byPage.values()];
    if (!obs.length) {
      issues.push({ slug: pub.slug, canon, pages: pages.length, observations: 0,
                    status: 'no_evidence', segments: [], breaks: [], conflicts, rejected, staged: 0,
                    text_observations: textObs });
      continue;
    }

    const { brackets, unbracketed } = bracket(obs);
    const confirmed = brackets.filter(s => s.obs.length >= MIN_SEGMENT_OBS);

    // A lone observation that brackets with neither neighbour is a SEQUENCE BREAK. Classify it —
    // the three cases mean different things and lumping them would bury the real findings:
    //   break_printed — a T2 spine folio standing alone. The magazine itself said this. Real:
    //                   an insert, a foldout, a gatefold, or a page missing from the scan.
    //   suspect_text  — a T4 isolated integer sitting INSIDE a span two other observations
    //                   already bracket. An age, a price, a street number — not a folio.
    //   break_text    — a T4 singleton outside every confirmed span. Genuinely unknown; eyes.
    const spans = confirmed.map(s => [s.page_first, s.page_last]);
    const inConfirmedSpan = n => spans.some(([a, b]) => n >= a && n <= b);

    /** The offset of the confirmed bracket nearest this page, or null if none exists. */
    const nearestOffset = n => {
      let best = null, bestD = Infinity;
      for (const c of confirmed) {
        const d = n < c.page_first ? c.page_first - n : n > c.page_last ? n - c.page_last : 0;
        if (d < bestD) { bestD = d; best = c.offset; }
      }
      return best;
    };

    const breaks = unbracketed.map(o => {
      const off = o.folio - o.page_number;
      const near = nearestOffset(o.page_number);
      const delta = near == null ? null : off - near;
      let kind;
      // Agreeing with the local offset is not a break, whatever the bracketing did. Adjacent-pair
      // bracketing fails whenever a page's IMMEDIATE neighbour contradicts, so a perfectly good
      // observation next to a bad one came out labelled "break" — 34 of them on the prior run.
      // The break is the contradicting page, not its neighbours.
      if (delta === 0) kind = 'unbracketed_agrees';
      else if (o.tier !== 'T2') kind = inConfirmedSpan(o.page_number) ? 'suspect_text' : 'break_text';
      // A T2 folio one off the local offset is almost always the SPINE's page_start being
      // approximate, not a physical insert — many of these notes say so in their own words
      // ("opener approximate", "boundary approximate"). Calling it a structural break would
      // bury the handful of real ones. It is still a finding: the spine opener is off by one.
      else if (delta != null && Math.abs(delta) === 1) kind = 'opener_off_by_one';
      else kind = 'break_printed';
      return { offset: off, page_first: o.page_number, obs: [o], kind, delta_vs_local: delta };
    });

    // --- stage
    const rows = [];
    const covered = new Set();
    const pageById = new Map(pages.map(p => [p.page_number, p]));

    for (const seg of confirmed) {
      for (let n = seg.page_first; n <= seg.page_last; n++) {
        const pg = pageById.get(n);
        if (!pg) continue;
        const folio = n + seg.offset;
        if (folio < 1) continue;                       // front matter: unnumbered, not zero
        const o = byPage.get(n);
        covered.add(n);
        rows.push({
          page_id: pg.id, publication_id: pub.id, slug: pub.slug, issue_canon: canon,
          page_number: n, printed_folio: folio,
          method: o ? o.source : 'derived_offset',
          tier: o ? o.tier : (seg.obs.some(x => x.tier === 'T2') ? 'T2' : 'T4'),
          offset: seg.offset,
          evidence: o ? o.evidence
                      : `interpolated between observed pp.${seg.page_first} and ${seg.page_last} at offset ${seg.offset}`,
        });
      }
    }

    // An OBSERVED folio is a fact about its own page whether or not it bracketed with a
    // neighbour. Bracketing exists to extend evidence across unobserved pages, not to license
    // the evidence itself. Dropping these lost 120 directly-read folios on the prior run.
    //
    // BUT a T4 (OCR isolated-integer) observation that brackets with NEITHER neighbour is a
    // `break_text` — the design's own verdict is "genuinely unknown; eyes", and the header
    // promises breaks are never staged. Staging it anyway broke that promise and, worse, staged
    // ad-copy integers as folios: "15 YEARS" (stbarth-01 p.56), "50 - a retrospective"
    // (stbarth-21 p.104), a gallery's "since 2011" (stbarth-13 p.45), and OCR 29 vs spine 71
    // (stbarth-01 p.74, a --validate gross miss). A T4 singleton with no corroborating bracket
    // is exactly the "wrong folio is worse than a missing one" case this file exists to prevent.
    // T2 breaks (break_printed / opener_off_by_one) are the magazine's OWN printed number and
    // stay — they are a fact about their page even unbracketed. Only uncovered T4 is dropped.
    for (const o of obs) {
      if (covered.has(o.page_number)) continue;
      if (o.tier !== 'T2') continue;   // uncovered T4 = break_text/suspect_text -> eyes, not staged
      const pg = pageById.get(o.page_number);
      if (!pg) continue;
      covered.add(o.page_number);
      rows.push({
        page_id: pg.id, publication_id: pub.id, slug: pub.slug, issue_canon: canon,
        page_number: o.page_number, printed_folio: o.folio,
        method: o.source, tier: o.tier, offset: o.folio - o.page_number,
        unbracketed: true, evidence: o.evidence,
      });
    }

    // --- extrapolate ONLY when the issue tells one story: one confirmed offset, zero breaks
    const extrapolated = [];
    const realBreaks = breaks.filter(b => b.kind !== 'unbracketed_agrees');
    if (confirmed.length === 1 && realBreaks.length === 0) {
      const off = confirmed[0].offset;
      for (const pg of pages) {
        if (covered.has(pg.page_number)) continue;
        const folio = pg.page_number + off;
        if (folio < 1) continue;
        extrapolated.push({
          page_id: pg.id, publication_id: pub.id, slug: pub.slug, issue_canon: canon,
          page_number: pg.page_number, printed_folio: folio,
          method: 'extrapolated_offset', tier: 'T4', offset: off,
          evidence: `single confirmed offset ${off} over ${confirmed[0].obs.length} observations, no sequence break`,
        });
      }
    }

    issues.push({
      slug: pub.slug, canon, pages: pages.length,
      observations: obs.length,
      obs_printed: obs.filter(o => o.tier === 'T2').length,
      obs_text: obs.filter(o => o.tier === 'T4').length,
      corroborated: obs.filter(o => o.corroborated_by_text).length,
      status: confirmed.length ? 'offset_confirmed' : (obs.length ? 'insufficient_evidence' : 'no_evidence'),
      segments: confirmed.map(s => ({ offset: s.offset, page_first: s.page_first, page_last: s.page_last, observations: s.obs.length })),
      corroborating_unbracketed: breaks.length - realBreaks.length,
      text_observations: textObs,
      breaks: realBreaks.map(s => ({ kind: s.kind, page_number: s.page_first, folio: s.obs[0].folio, offset: s.offset, delta_vs_local: s.delta_vs_local, source: s.obs[0].source, evidence: s.obs[0].evidence })),
      conflicts, rejected,
      staged: rows.length, staged_extrapolated: extrapolated.length,
      rows, extrapolated,
    });
  }

  return { issues, totalPages, scope, only };
}

// ---------------------------------------------------------------- report + stage

function summarise(r) {
  const withOffset = r.issues.filter(i => i.status === 'offset_confirmed');
  const staged = withOffset.reduce((a, i) => a + i.staged, 0);
  const extra = withOffset.reduce((a, i) => a + i.staged_extrapolated, 0);
  const observed = r.issues.reduce((a, i) => a + i.observations, 0);
  const breaks = r.issues.reduce((a, i) => a + i.breaks.length, 0);
  const conflicts = r.issues.reduce((a, i) => a + i.conflicts.length, 0);
  // A publication row is NOT an issue. 41 L'Officiel rows are 15 issues x cover variants that
  // share one phash-identical interior (progressive-extraction.md, corrected 2026-07-20).
  // Counting rows as issues is the exact error that manufactured a 26-issue phantom gap, and
  // it would inflate every number below by ~2.7x. Report both, name which is which.
  const canons = new Set(r.issues.map(i => i.canon).filter(Boolean));
  const canonsConfirmed = new Set(withOffset.map(i => i.canon).filter(Boolean));
  const breakKinds = {};
  for (const i of r.issues) for (const b of i.breaks) breakKinds[b.kind] = (breakKinds[b.kind] || 0) + 1;
  return { publication_rows: r.issues.length, distinct_issues: canons.size,
           pages: r.totalPages, observed,
           issues_with_confirmed_offset: canonsConfirmed.size,
           publication_rows_with_confirmed_offset: withOffset.length,
           staged, extrapolated: extra,
           sequence_breaks: breaks, break_kinds: breakKinds, conflicts };
}

function stagePayload(r) {
  const rows = [], extra = [];
  for (const i of r.issues) { rows.push(...(i.rows || [])); extra.push(...(i.extrapolated || [])); }
  return {
    generated_at: new Date().toISOString(),
    generator: 'scripts/entity/folio-extract.mjs',
    target_column: 'publication_pages.printed_folio',
    column_exists: false,
    proposal: 'docs/architecture/FOLIO_COLUMN_PROPOSAL.md',
    scope: r.scope, only: r.only,
    summary: summarise(r),
    // Kept apart on purpose. `rows` are observed or interpolated between two agreeing
    // observations. `extrapolated` are arithmetic beyond any evidence. Land the first
    // without hesitation; the second is an owner decision.
    rows, extrapolated: extra,
    issues: r.issues.map(({ rows: _r, extrapolated: _e, ...rest }) => rest),
  };
}

// ---------------------------------------------------------------- cli

const argv = process.argv.slice(2);
const arg = k => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const has = k => argv.includes(k);

if (import.meta.url === `file://${process.argv[1]}`) {
  const scope = arg('--scope') || 'lofficiel';
  const only = arg('--issue');

  if (has('--check')) {
    // The executable check. Prose gets skipped; a failing exit code does not.
    if (!existsSync(STAGE)) {
      console.error(`FAIL  no staging file at ${STAGE} — run without --check first.`);
      process.exit(1);
    }
    const prev = JSON.parse(readFileSync(STAGE, 'utf8'));
    const now = stagePayload(await derive({ scope: prev.scope, only: prev.only }));
    const key = x => `${x.page_id}`;
    const a = new Map(prev.rows.map(x => [key(x), x.printed_folio]));
    const b = new Map(now.rows.map(x => [key(x), x.printed_folio]));
    const changed = [], added = [], removed = [];
    for (const [k, v] of b) { if (!a.has(k)) added.push(k); else if (a.get(k) !== v) changed.push({ k, from: a.get(k), to: v }); }
    for (const k of a.keys()) if (!b.has(k)) removed.push(k);
    console.log(`folio staging check — ${prev.rows.length} staged -> ${now.rows.length} re-derived`);
    console.log(`  changed ${changed.length}  added ${added.length}  removed ${removed.length}`);
    if (changed.length) {
      console.error('\nFAIL  a folio MOVED. A staged folio changing value means the evidence changed');
      console.error('      underneath it. Do not re-run and overwrite — find out why.');
      for (const c of changed.slice(0, 20)) console.error(`      page ${c.k}: ${c.from} -> ${c.to}`);
      process.exit(1);
    }
    if (added.length || removed.length) {
      console.log('\nOK (drift, no contradiction) — new evidence arrived; re-run without --check to restage.');
    } else {
      console.log('\nOK  staged folios reproduce exactly.');
    }
    process.exit(0);
  }

  if (has('--validate')) {
    // HOLDOUT. The two evidence sources are independent: the spine folios were read off printed
    // TOCs by a strong model; the OCR integers came out of a 7B discovery sweep that never saw
    // the spine. So derive the folio map from the SPINE ALONE, then ask the OCR numbers whether
    // they agree. Agreement is not circular — it is the accuracy of the whole method.
    const full = await derive({ scope, only });
    const spineOnly = await derive({ scope, only, textEvidence: false });
    const map = new Map();
    for (const row of spineOnly.issues.flatMap(i => i.rows || [])) map.set(row.page_id, row.printed_folio);
    let agree = 0, disagree = 0, uncovered = 0;
    const misses = [];
    for (const i of full.issues) {
      for (const o of i.text_observations || []) {
        const got = map.get(o.page_id);
        if (got == null) { uncovered++; continue; }
        if (got === o.folio) agree++;
        else { disagree++; misses.push(`${i.slug} p.${o.page_number}: OCR ${o.folio}, spine-derived ${got}`); }
      }
    }
    const n = agree + disagree;
    console.log('folio holdout — OCR folios vs a folio map built from the printed spine ALONE\n');
    console.log(`  OCR folio readings total          : ${agree + disagree + uncovered}`);
    console.log(`  ...on a page the spine map covers : ${n}`);
    console.log(`  AGREE                             : ${agree}`);
    console.log(`  disagree                          : ${disagree}`);
    console.log(`  accuracy                          : ${n ? (100 * agree / n).toFixed(1) : 'n/a'}%`);
    for (const m of misses) console.log(`    MISS ${m}`);
    process.exit(0);
  }

  const r = await derive({ scope, only });
  const payload = stagePayload(r);
  const s = payload.summary;

  console.log(`folio-extract — scope=${scope}${only ? ` issue=${only}` : ''}\n`);
  console.log(`publication rows scanned        : ${s.publication_rows}  (= ${s.distinct_issues} distinct issues x cover variants)`);
  console.log(`pages scanned                   : ${s.pages}`);
  console.log(`folio OBSERVATIONS (read, not inferred): ${s.observed}`);
  console.log(`ISSUES with a confirmed offset  : ${s.issues_with_confirmed_offset} of ${s.distinct_issues}   (${s.publication_rows_with_confirmed_offset} publication rows)`);
  console.log(`pages with a recovered folio    : ${s.staged}   (observed + interpolated)`);
  console.log(`...plus extrapolated, staged apart: ${s.extrapolated}`);
  console.log(`SEQUENCE BREAKS                 : ${s.sequence_breaks}  ${JSON.stringify(s.break_kinds)}`);
  console.log(`spine-vs-text conflicts         : ${s.conflicts}`);

  // One representative per canon. Cover variants share an interior, so printing all of them
  // repeats each finding up to 6 times and buries the distinct ones.
  console.log(`\nper issue (cover variants collapsed)\n${'-'.repeat(96)}`);
  const seen = new Set();
  for (const i of r.issues.sort((a, b) => (a.slug || '').localeCompare(b.slug || ''))) {
    if (!i.observations && !only) continue;
    if (!only && i.canon) {
      if (seen.has(i.canon)) continue;
      seen.add(i.canon);
    }
    const segs = i.segments.map(x => `${x.offset >= 0 ? '+' : ''}${x.offset}@pp.${x.page_first}-${x.page_last}(${x.observations})`).join(' ');
    console.log(`${(i.slug || '?').padEnd(26)} pp=${String(i.pages).padStart(4)} obs=${String(i.observations).padStart(3)}` +
                ` (T2 ${String(i.obs_printed || 0).padStart(2)} / T4 ${String(i.obs_text || 0).padStart(2)})` +
                ` staged=${String(i.staged).padStart(4)} ${i.status}`);
    if (segs) console.log(`  offsets: ${segs}`);
    for (const b of i.breaks) console.log(`  ${b.kind.toUpperCase().padEnd(17)} pdf p.${b.page_number} claims folio ${b.folio} (offset ${b.offset}, local ${b.delta_vs_local >= 0 ? '+' : ''}${b.delta_vs_local}) — ${String(b.evidence || '').slice(0, 60)}`);
    for (const c of i.conflicts) console.log(`  CONFLICT pdf p.${c.page_number}: text says ${c.text}, printed spine says ${c.spine} — spine wins (T2>T4)`);
    for (const x of i.rejected) console.log(`  reject pdf p.${x.page_number} folio ${x.folio}: ${x.why}`);
  }

  mkdirSync(dirname(STAGE), { recursive: true });
  writeFileSync(STAGE, JSON.stringify(payload, null, 2));
  console.log(`\nstaged -> ${STAGE}`);
  console.log(`NO COLUMN WRITTEN. publication_pages.printed_folio does not exist; see ${payload.proposal}`);
  console.log(`re-verify any time:  node scripts/entity/folio-extract.mjs --check`);
}
