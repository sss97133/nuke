#!/usr/bin/env node
/**
 * Join publication_pages to mag_stories — the missing key.
 *
 * THE GAP. `mag_stories` keys on `issue_canon` ("lofficiel_stbarth:#11:2025"); `publication_pages`
 * keys on `publication_id`. Nothing joins them. Consequence, measured 2026-07-20: every
 * "which story is this page in" question returns nothing, and matching on page_number alone
 * crosses titles — a Riviera page resolved to a St Barth story, silently.
 *
 * That single missing key is why:
 *   - a subject inherits the PAGE and stops, never the story, section, or ad-vs-editorial verdict
 *   - counts are computed over pages when 70% of stories span more than one (median 2, p90 12, max 37)
 *   - "editorial presence" cannot distinguish a 12-page feature from a one-page mention
 *
 * THE KEY, derived not invented. The spine's canon format is `<title>:<issue|season>:<year>`, and
 * publications.metadata already carries every part:
 *   brand "St Barth" -> lofficiel_stbarth   |  brand "Riviera" -> lofficiel_riviera
 *   issue_no when present, else season       |  year
 * Verified against the live spine: lofficiel-stbarth-01 (issue_no 11, 2025) -> lofficiel_stbarth:#11:2025
 * and lofficiel-riviera-06 (issue_no null, season "été", 2023) -> lofficiel_riviera:été:2023, both of
 * which exist in mag_stories.
 *
 * Exported so any caller can ask the two questions that matter:
 *   canonOf(publication)            -> the issue_canon key, or null if not derivable
 *   storyFor(page, storiesByCanon)  -> the spine row covering that page, or null
 *
 * Read-only. Writes nothing.
 *
 * Usage: node scripts/entity/mag-spine-join.mjs [--sample <n>]
 */
import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const TITLE = { 'st barth': 'lofficiel_stbarth', 'riviera': 'lofficiel_riviera' };

/**
 * Fallback title when `metadata.brand` is absent. The slug of a L'Officiel PDF publication
 * is `lofficiel-<title>-<seq>` and names the title unambiguously.
 *
 * This is a corroborated read, not a guess: for all four publications that needed it
 * (stbarth-07/23/24/25), page 1's own printed text begins "L'OFFICIEL ST BARTH ISSUE NN — ..."
 * (measured 2026-07-20), so the slug agrees with the printed cover. The fallback fires only
 * when `brand` is missing — it never contradicts a stated brand. Anything not matching this
 * exact slug shape still returns null.
 */
const TITLE_FROM_SLUG = (slug) => {
  const m = /^lofficiel-(stbarth|riviera)-\d+$/.exec(String(slug || ''));
  return m ? (m[1] === 'stbarth' ? 'lofficiel_stbarth' : 'lofficiel_riviera') : null;
};

/** The canon key for a publication row, or null when the metadata cannot support one. */
export function canonOf(pub) {
  const m = pub?.metadata || {};
  const title = TITLE[String(m.brand || '').toLowerCase()] || TITLE_FROM_SLUG(pub?.slug);
  if (!title || !m.year) return null;
  // The spine's own fallback order: issue number first, season second. Anything else is not
  // derivable and must return null rather than a guess — a wrong canon silently attaches a page
  // to another magazine's story, which is the defect this file exists to stop.
  const mid = m.issue_no != null ? `#${m.issue_no}` : (m.season || null);
  if (!mid) return null;
  return `${title}:${mid}:${m.year}`;
}

/** The spine row covering this page, or null. Never matches across issues. */
export function storyFor(page, canon, byCanon) {
  if (!canon) return null;
  const rows = byCanon.get(canon);
  if (!rows) return null;
  return rows.find(s => page.page_number >= s.page_start
                     && page.page_number <= (s.page_end ?? s.page_start)) || null;
}

async function pageAll(t, sel, ord) {
  let o = [], i = 0;
  for (;;) {
    const { data, error } = await sb.from(t).select(sel).order(ord).range(i, i + 999);
    if (error) throw new Error(`${t}: ${error.message}`);
    if (!data?.length) break;
    o.push(...data);
    if (data.length < 1000) break;
    i += 1000;
  }
  return o;
}

export async function loadSpine() {
  const stories = await pageAll('mag_stories', 'id,issue_canon,kind,title,page_start,page_end,brands,people,source_tier', 'id');
  const byCanon = new Map();
  for (const s of stories) {
    if (!byCanon.has(s.issue_canon)) byCanon.set(s.issue_canon, []);
    byCanon.get(s.issue_canon).push(s);
  }
  return { stories, byCanon };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { stories, byCanon } = await loadSpine();
  const pubs = await pageAll('publications', 'id,slug,title,metadata', 'id');
  const pages = await pageAll('publication_pages', 'id,publication_id,page_number,page_type,spatial_tags', 'id');
  const PUB = new Map(pubs.map(p => [p.id, p]));

  console.log(`spine: ${stories.length} stories across ${byCanon.size} issues`);
  console.log(`pages: ${pages.length} across ${pubs.length} publications\n`);

  let derivable = 0, matchedCanon = 0;
  const canonByPub = new Map();
  for (const p of pubs) {
    const c = canonOf(p);
    canonByPub.set(p.id, c);
    if (c) derivable++;
    if (c && byCanon.has(c)) matchedCanon++;
  }
  console.log(`publications with a derivable canon key : ${derivable} of ${pubs.length}`);
  console.log(`...whose canon exists in the spine      : ${matchedCanon}`);

  let inStory = 0, orphan = 0, noCanon = 0;
  const kinds = {};
  for (const p of pages) {
    const canon = canonByPub.get(p.publication_id);
    if (!canon) { noCanon++; continue; }
    const s = storyFor(p, canon, byCanon);
    if (s) { inStory++; kinds[s.kind] = (kinds[s.kind] || 0) + 1; }
    else orphan++;
  }
  console.log(`\npages now resolving to a story : ${inStory}`);
  console.log(`pages in a spined issue, no story: ${orphan}`);
  console.log(`pages whose issue has no canon  : ${noCanon}   <- mostly non-L'Officiel titles`);
  console.log(`page kinds via the spine        : ${JSON.stringify(kinds)}`);

  // Prove it does NOT cross titles — the defect that motivated this file.
  const riviera = pages.find(p => (PUB.get(p.publication_id)?.slug || '').startsWith('lofficiel-riviera') && p.page_number === 21);
  if (riviera) {
    const canon = canonByPub.get(riviera.publication_id);
    const s = storyFor(riviera, canon, byCanon);
    console.log(`\ncross-title check — Riviera page 21:`);
    console.log(`  publication: ${PUB.get(riviera.publication_id)?.slug}  canon: ${canon}`);
    console.log(`  story: ${s ? `${s.kind} "${s.title}" pp.${s.page_start}-${s.page_end} [${s.issue_canon}]` : 'none in this issue (correctly refuses rather than matching another magazine)'}`);
  }
}
