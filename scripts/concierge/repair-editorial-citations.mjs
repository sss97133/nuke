#!/usr/bin/env node
// repair-editorial-citations.mjs
//
// DEFECT: link-org-editorial.mjs cited pages from L'OFFICIEL RIVIERA as editorial
// evidence for SAINT BARTH orgs. Riviera is a different magazine covering the French
// Riviera; for a multi-outlet brand (Nikki Beach, Bagatelle, Cheval Blanc, La Guerite)
// those pages describe a DIFFERENT VENUE OF THE SAME BRAND. The profile's editorial
// footprint therefore drills to evidence about St-Tropez / Cannes / Monte-Carlo.
//
// This is the same wrong-outlet class the run explicitly rejected for "Villa Marie
// Saint-Tropez" — it caught it on name matches and missed it on brand tags.
//
// REPAIR (additive + reversible, house pattern from clean-org-defects.mjs):
//   - the verbatim original citations array is copied to
//     metadata.quarantine.citations {value, reason, quarantined_at, quarantined_by, restore}
//   - metadata.citations is rewritten to the island-anchored subset ONLY
//   - metadata.wrong_outlet_citations records what was pulled and why
//   - counts (editorial_pages_brand_tag / _text / editorial_issues) recomputed from the survivors
//   - NOTHING is deleted. No organization_brands row is removed. No axis is flipped by
//     this script: every repaired org retains >=1 St Barth citation, so ax_editorial is
//     unchanged. Orgs whose surviving evidence is ads/TOC only are FLAGGED for the owner,
//     never silently demoted.
//
// Usage: dotenvx run --quiet -- node scripts/concierge/repair-editorial-citations.mjs [--apply]

const URL = process.env.VITE_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APPLY = process.argv.includes('--apply');
const NOW = new Date().toISOString();
const BY = 'repair-editorial-citations.mjs';
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const q = async (p, init = {}) => {
  const r = await fetch(`${URL}/rest/v1/${p}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  return r.status === 204 ? null : r.json();
};
async function paged(path, order = 'id') {
  const out = []; let f = 0;
  for (;;) {
    const r = await fetch(`${URL}/rest/v1/${path}&order=${order}`, { headers: { ...H, Range: `${f}-${f + 999}` } });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const rows = await r.json(); out.push(...rows);
    if (rows.length < 1000) break; f += 1000;
  }
  return out;
}
const deac = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '');

// A citation is island-anchored only if it comes from a St Barth issue.
// Riviera issues are a different magazine for a different region: for a
// multi-outlet brand they are, by construction, about another venue.
const isIslandIssue = (slug) => /stbarth/i.test(slug || '');

const ISL = /saint[- ]?barth|st[- ]?barth|97133|gustavia|saint[- ]jean|flamands|\btoiny\b|lorient/i;
const RIV = /saint[- ]?tropez|st[- ]?tropez|\bcannes\b|ramatuelle|monte[- ]?carlo|\bmonaco\b|\bantibes\b|sainte[- ]marguerite|tropezienne|\briviera\b/i;

const pubCache = new Map();
async function pubId(slug) {
  if (pubCache.has(slug)) return pubCache.get(slug);
  const r = await q(`publications?select=id&slug=eq.${slug}`);
  const id = r[0]?.id; pubCache.set(slug, id); return id;
}
const pageCache = new Map();
async function pageInfo(slug, page) {
  const k = `${slug}#${page}`;
  if (pageCache.has(k)) return pageCache.get(k);
  const pid = await pubId(slug);
  let info = { text: '', type: null };
  if (pid) {
    const r = await q(`publication_pages?select=extracted_text,page_type&publication_id=eq.${pid}&page_number=eq.${page}`);
    info = { text: deac(r[0]?.extracted_text || ''), type: r[0]?.page_type || null };
  }
  pageCache.set(k, info); return info;
}

const orgs = await paged('organizations?select=id,name&metadata->>project=eq.lofficiel-concierge', 'id');
const byId = new Map(orgs.map((o) => [o.id, o.name]));

const ob = await paged('organization_brands?select=id,organization_id,metadata', 'organization_id');
const ed = ob.filter((r) => r.metadata?.run === '2026-07-19-editorial-crosslink');
console.error(`editorial-crosslink rows: ${ed.length}`);

const plan = [];
for (const row of ed) {
  const nm = byId.get(row.organization_id) || '(unknown)';
  const cites = row.metadata?.citations || [];
  const keep = [], drop = [];
  for (const c of cites) {
    if (isIslandIssue(c.slug)) { keep.push(c); continue; }
    const info = await pageInfo(c.slug, c.page);
    const i = info.text.toLowerCase().search(/[a-z]/);
    const w = info.text;
    drop.push({
      ...c,
      page_type: info.type,
      basis: RIV.test(w) && !ISL.test(w) ? 'prose describes a Riviera venue'
        : ISL.test(w) && RIV.test(w) ? 'global brand location list — not St Barth coverage'
        : 'no St Barth locator on the page',
    });
  }
  if (!drop.length) continue;
  // characterise what survives, so an org left with only ads/TOC is visible not hidden
  const survivors = [];
  for (const c of keep) {
    const info = await pageInfo(c.slug, c.page);
    survivors.push({ ...c, page_type: info.type });
  }
  const realEditorial = survivors.filter((s) => s.page_type === 'editorial');
  plan.push({ row, nm, cites, keep, drop, survivors, realEditorial });
}

console.error(`\n=== PLAN (${APPLY ? 'APPLY' : 'DRY RUN'}) ===`);
let totalDrop = 0;
for (const p of plan) {
  totalDrop += p.drop.length;
  console.error(`\n${p.nm}  ${p.cites.length} citations -> keep ${p.keep.length}, quarantine ${p.drop.length}`);
  for (const d of p.drop) console.error(`   PULL  ${d.slug} p${d.page} [${d.page_type}] — ${d.basis}`);
  const kinds = p.survivors.map((s) => s.page_type || '?').join(', ');
  console.error(`   survivors page_types: ${kinds || '(none)'}`);
  if (!p.realEditorial.length) console.error(`   !! NO surviving page_type='editorial' — evidence is ads/TOC only. FLAGGED for owner, axis left untouched.`);
}
console.error(`\ncitations to quarantine: ${totalDrop} across ${plan.length} profiles`);

if (!APPLY) { console.error('\nDRY RUN — nothing written. Re-run with --apply.'); process.exit(0); }

let n = 0;
for (const p of plan) {
  const cur = (await q(`organization_brands?select=metadata&id=eq.${p.row.id}`))[0]?.metadata || {};
  const tagKeep = p.keep.length;
  const meta = {
    ...cur,
    citations: p.keep,
    editorial_pages_brand_tag: Math.min(cur.editorial_pages_brand_tag ?? tagKeep, tagKeep),
    editorial_pages_text: Math.min(cur.editorial_pages_text ?? tagKeep, tagKeep),
    editorial_issues: new Set(p.keep.map((c) => c.canon)).size,
    wrong_outlet_citations: {
      pulled: p.drop,
      reason: 'cited L\'OFFICIEL RIVIERA pages as editorial evidence for a SAINT BARTH org; '
        + 'for a multi-outlet brand these describe a different venue of the same brand',
      detected_by: BY, detected_at: NOW,
    },
    evidence_after_repair: {
      surviving_citations: p.survivors.map((s) => ({ slug: s.slug, page: s.page, page_type: s.page_type })),
      surviving_editorial_pages: p.realEditorial.length,
      note: p.realEditorial.length
        ? 'retains genuine St Barth editorial coverage'
        : 'NO surviving editorial page — remaining St Barth evidence is advertising/table-of-contents only; ax_editorial left TRUE pending owner ruling',
    },
    quarantine: {
      ...(cur.quarantine || {}),
      citations: {
        value: p.cites,
        reason: 'wrong-outlet citations (L\'Officiel Riviera) on a St Barth org',
        quarantined_at: NOW, quarantined_by: BY,
        restore: `UPDATE organization_brands SET metadata = jsonb_set(metadata, '{citations}', metadata->'quarantine'->'citations'->'value') WHERE id = '${p.row.id}'`,
      },
    },
  };
  await q(`organization_brands?id=eq.${p.row.id}`, {
    method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ metadata: meta }),
  });
  n++;
  console.error(`repaired ${p.nm}`);
}
console.error(`\nrepaired ${n}/${plan.length} rows; ${totalDrop} citations quarantined (reversible, nothing deleted)`);
