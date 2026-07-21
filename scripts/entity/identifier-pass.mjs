#!/usr/bin/env node
// scripts/entity/identifier-pass.mjs — the `identifier` pass of the extraction
// ladder defined in docs/library/reference/dictionary/progressive-extraction.md.
//
// WHAT IT IS
//   Printed identifiers (phone, domain, email, social handle) survive OCR drift
//   and name collision. Names do not. This pass reads every publication_pages
//   row, extracts printed identifiers from the page text, and matches them
//   against organizations (country='BL').
//
// WHAT IT IS NOT
//   It is NOT a linker and it WRITES NOTHING. It emits a staging NDJSON of
//   CANDIDATE links for a downstream grader. A phone hit is not an endorsement:
//   a page carrying a dozen orgs' numbers in a row is a directory listing, and
//   `other_org_ids_on_page` is the field that lets the grader see that cheaply.
//
// TRUST TIER: hallucination-survivable. The string is on the page or it is not.
//
// USAGE (from /Users/skylar/nuke):
//   dotenvx run --quiet -- node scripts/entity/identifier-pass.mjs [--out PATH]

import fs from 'node:fs';
import path from 'node:path';

const OUT = (() => {
  const i = process.argv.indexOf('--out');
  return i > -1 ? process.argv[i + 1]
    : path.join(process.cwd(), 'output', 'identifier-pass-candidates.ndjson');
})();

// ── identifier normalisers ──────────────────────────────────────────────────

/** Phone → last 9 digits. Collapses +590 / 0590 / 00590 / spacing variance. */
function phoneTail(raw) {
  const d = String(raw).replace(/\D/g, '');
  if (d.length < 9) return null;
  return d.slice(-9);
}

/** Registrable domain, lowercased. Strips scheme, www., path, port. */
function regDomain(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  s = s.split(/[/?#:]/)[0];
  const parts = s.split('.').filter(Boolean);
  if (parts.length < 2) return null;
  // two-level public suffixes we actually see on this corpus
  const twoLevel = new Set(['co.uk', 'com.br', 'co.jp', 'com.au']);
  const last2 = parts.slice(-2).join('.');
  const take = twoLevel.has(last2) ? 3 : 2;
  if (parts.length < take) return null;
  const dom = parts.slice(-take).join('.');
  if (!/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(dom)) return null;
  if (dom.length < 5) return null;
  return dom;
}

function normEmail(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

/** Instagram handle → bare lowercase handle. Accepts URL or @handle. */
function igHandle(raw) {
  if (!raw) return null;
  let s = String(raw).trim().toLowerCase();
  const m = s.match(/instagram\.com\/([a-z0-9._]{2,30})/);
  if (m) s = m[1];
  s = s.replace(/^@/, '').replace(/\/+$/, '');
  if (!/^[a-z0-9._]{3,30}$/.test(s)) return null;
  // reject things that are obviously not handles
  if (/^\d+$/.test(s)) return null;
  return s;
}

// ── page-side extraction ────────────────────────────────────────────────────
// Generic, un-targeted: we pull every plausible identifier so the DENOMINATOR
// ("how many pages carry an identifier at all") is honest, then intersect with
// the org index. Extraction never consults the org list — that would make the
// yield a function of the answer key.

const RE_DIGITRUN = /\+?\d[\d\s.   ().\-–—/]{6,28}\d/g;
const RE_EMAIL = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const RE_URLDOM = /(?:https?:\/\/)?(?:www\.)?([a-z0-9][a-z0-9-]{1,62}(?:\.[a-z0-9-]{2,63})+)(?=[/\s,;)"'<]|$)/gi;
const RE_IG = /(?:instagram\.com\/|@)([a-z0-9._]{3,30})/gi;
// TLDs we accept from bare-text domain matches (bare regex over OCR text
// otherwise turns "Fig.2" and "St.Barth" into domains).
const TLD_OK = new Set([
  'com', 'fr', 'net', 'org', 'gp', 'io', 'co', 'eu', 'us', 'travel', 'shop',
  'hotel', 'paris', 'blue', 'art', 'info', 'biz', 'tv', 'me', 'be', 'ch',
  'it', 'es', 'de', 'nl', 'club', 'agency', 'boutique', 'restaurant', 'villa',
]);

/**
 * Phone candidates on a page.
 * A digit run may be several printed numbers fused by OCR ("0590277532 /
 * 0690673383"), so every 9-digit window of a run is a candidate tail. A
 * coincidental 9-digit collision with a known org is ~1655/1e9 — negligible —
 * and this is what lets the pass see a directory page for what it is.
 */
function extractPhones(text) {
  const out = [];
  let m;
  RE_DIGITRUN.lastIndex = 0;
  while ((m = RE_DIGITRUN.exec(text)) !== null) {
    const raw = m[0];
    const d = raw.replace(/\D/g, '');
    if (d.length < 9 || d.length > 30) continue;
    const seen = new Set();
    for (let i = 0; i + 9 <= d.length; i++) {
      const tail = d.slice(i, i + 9);
      if (seen.has(tail)) continue;
      seen.add(tail);
      out.push({ tail, raw, index: m.index });
    }
  }
  return out;
}

function extractDomains(text) {
  const out = [];
  let m;
  RE_URLDOM.lastIndex = 0;
  while ((m = RE_URLDOM.exec(text)) !== null) {
    const host = m[1].toLowerCase();
    const tld = host.split('.').pop();
    if (!TLD_OK.has(tld)) continue;
    const dom = regDomain(host);
    if (!dom) continue;
    out.push({ value: dom, raw: m[0], index: m.index });
  }
  return out;
}

function extractEmails(text) {
  const out = [];
  let m;
  RE_EMAIL.lastIndex = 0;
  while ((m = RE_EMAIL.exec(text)) !== null) {
    const e = normEmail(m[0]);
    if (e) out.push({ value: e, raw: m[0], index: m.index });
  }
  return out;
}

function extractIg(text) {
  const out = [];
  let m;
  RE_IG.lastIndex = 0;
  while ((m = RE_IG.exec(text)) !== null) {
    const h = igHandle(m[1]);
    if (!h) continue;
    out.push({ value: h, raw: m[0], index: m.index });
  }
  return out;
}

function snippet(text, index, len) {
  const a = Math.max(0, index - 90);
  const b = Math.min(text.length, index + len + 90);
  return text.slice(a, b).replace(/\s+/g, ' ').trim();
}

// ── main ────────────────────────────────────────────────────────────────────

// PostgREST reader. DATABASE_URL is a placeholder in this repo's .env, so the
// only working transport is REST. PostgREST hard-caps every response at 1000
// rows and silently clamps larger limits — every read here paginates, and a
// short page is the only valid stop condition.
const REST = `${process.env.VITE_SUPABASE_URL}/rest/v1`;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function restPage(table, select, { order = 'id', from = 0, size = 500, filter = '' } = {}) {
  const url = `${REST}/${table}?select=${encodeURIComponent(select)}&order=${order}${filter}`;
  const res = await fetch(url, {
    headers: {
      apikey: KEY, Authorization: `Bearer ${KEY}`,
      Range: `${from}-${from + size - 1}`, 'Range-Unit': 'items',
    },
  });
  if (!res.ok) throw new Error(`${table} ${res.status} ${await res.text()}`);
  return res.json();
}

async function restAll(table, select, opts = {}) {
  const size = opts.size || 1000;
  const out = [];
  for (let from = 0; ; from += size) {
    const rows = await restPage(table, select, { ...opts, from, size });
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}

async function main() {
  // 1. org index -----------------------------------------------------------
  const orgs = await restAll(
    'organizations', 'id,name,phone,website,email,social_links',
    { filter: '&country=eq.BL' }
  );

  const byPhone = new Map();   // tail -> Set(org_id)
  const byDomain = new Map();
  const byEmail = new Map();
  const byIg = new Map();
  const orgName = new Map();
  const add = (map, k, id) => {
    if (!k) return;
    if (!map.has(k)) map.set(k, new Set());
    map.get(k).add(id);
  };

  for (const o of orgs) {
    orgName.set(o.id, o.name);
    if (o.phone) {
      for (const chunk of String(o.phone).split(/[/;,]| ou |\bet\b/i)) {
        const t = phoneTail(chunk);
        // a chunk with >13 digits is two fused numbers — window it
        const d = chunk.replace(/\D/g, '');
        if (d.length >= 9 && d.length <= 13) add(byPhone, t, o.id);
        else if (d.length > 13) {
          for (let i = 0; i + 9 <= d.length; i++) add(byPhone, d.slice(i, i + 9), o.id);
        }
      }
    }
    add(byDomain, regDomain(o.website), o.id);
    add(byEmail, normEmail(o.email), o.id);
    const sl = o.social_links || {};
    add(byIg, igHandle(sl.instagram), o.id);
  }

  const orgStats = {
    total: orgs.length,
    with_phone_key: new Set([...byPhone.values()].flatMap((s) => [...s])).size,
    with_domain_key: new Set([...byDomain.values()].flatMap((s) => [...s])).size,
    with_email_key: new Set([...byEmail.values()].flatMap((s) => [...s])).size,
    with_ig_key: new Set([...byIg.values()].flatMap((s) => [...s])).size,
    distinct_phone_tails: byPhone.size,
    distinct_domains: byDomain.size,
    distinct_emails: byEmail.size,
    distinct_ig: byIg.size,
    // ambiguity: keys shared by >1 org
    phone_tails_shared: [...byPhone.values()].filter((s) => s.size > 1).length,
    domains_shared: [...byDomain.values()].filter((s) => s.size > 1).length,
  };

  // 2. publications lookup for source_url ----------------------------------
  const pubs = new Map();
  for (const p of await restAll('publications', 'id,title,slug,platform_url,issue_number')) {
    pubs.set(p.id, p);
  }

  const sourceUrl = (pubId, pageNo) => {
    const p = pubs.get(pubId);
    if (!p) return null;
    if (p.platform_url) {
      const base = p.platform_url.split('#')[0];
      return `${base}#p=${pageNo}`;
    }
    return null;
  };

  // 3. stream every page ---------------------------------------------------
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const ws = fs.createWriteStream(OUT, { flags: 'w' });

  const stats = {
    pages_total: 0,
    pages_text_column: 0,
    pages_rawtext_only: 0,
    pages_no_text: 0,
    pages_any_identifier: 0,
    pages_with_phone: 0, pages_with_domain: 0, pages_with_email: 0, pages_with_ig: 0,
    pages_matched_any: 0,
    pages_matched_phone: 0, pages_matched_domain: 0, pages_matched_email: 0, pages_matched_ig: 0,
    // where the text came from, for MATCHED pages
    matched_from_column: 0, matched_from_rawtext: 0,
    candidates: 0,
  };
  const matchedOrgs = { phone: new Set(), domain: new Set(), email: new Set(), ig: new Set() };
  const pagesByType = new Map();
  const orgPageSets = new Map(); // org -> Set(page_id) for any identifier

  const BATCH = 500;
  let from = 0;
  for (;;) {
    const rows = await restPage(
      'publication_pages',
      'id,publication_id,page_number,page_type,extracted_text,' +
      'raw_text:spatial_tags->>raw_text,tag_page_type:spatial_tags->>page_type',
      { order: 'id', from, size: BATCH }
    );
    if (rows.length === 0) break;
    from += rows.length;
    const short = rows.length < BATCH;

    for (const r of rows) {
      stats.pages_total++;
      const col = r.extracted_text && r.extracted_text.length ? r.extracted_text : null;
      const rawt = r.raw_text && r.raw_text.length ? r.raw_text : null;
      if (col) stats.pages_text_column++;
      else if (rawt) stats.pages_rawtext_only++;
      else { stats.pages_no_text++; continue; }

      // union both sources; remember which one carried the hit
      const sources = [];
      if (col) sources.push(['extracted_text', col]);
      if (rawt && rawt !== col) sources.push(['spatial_tags.raw_text', rawt]);

      const hits = [];      // {type, matched_value, evidence, org_ids, text_source}
      let sawPhone = false, sawDom = false, sawMail = false, sawIg = false;

      for (const [src, text] of sources) {
        for (const p of extractPhones(text)) {
          sawPhone = true;
          const ids = byPhone.get(p.tail);
          if (ids) hits.push({ type: 'phone', v: p.tail, ev: snippet(text, p.index, p.raw.length), ids, src });
        }
        for (const d of extractDomains(text)) {
          sawDom = true;
          const ids = byDomain.get(d.value);
          if (ids) hits.push({ type: 'domain', v: d.value, ev: snippet(text, d.index, d.raw.length), ids, src });
        }
        for (const e of extractEmails(text)) {
          sawMail = true;
          const ids = byEmail.get(e.value);
          if (ids) hits.push({ type: 'email', v: e.value, ev: snippet(text, e.index, e.raw.length), ids, src });
        }
        for (const g of extractIg(text)) {
          sawIg = true;
          const ids = byIg.get(g.value);
          if (ids) hits.push({ type: 'instagram', v: g.value, ev: snippet(text, g.index, g.raw.length), ids, src });
        }
      }

      if (sawPhone) stats.pages_with_phone++;
      if (sawDom) stats.pages_with_domain++;
      if (sawMail) stats.pages_with_email++;
      if (sawIg) stats.pages_with_ig++;
      if (sawPhone || sawDom || sawMail || sawIg) stats.pages_any_identifier++;
      if (hits.length === 0) continue;

      // all distinct orgs on this page — this is what makes a directory visible
      const allOrgs = [...new Set(hits.flatMap((h) => [...h.ids]))];
      // …but org_count alone LIES: 295 phone tails are shared by >1 organizations
      // row (duplicate/placeholder org records — e.g. tail 590277532 resolves to
      // 5 rows, only one of which is GUMBS CAR RENTAL). The honest directory
      // signal is the number of DISTINCT PRINTED identifiers on the page.
      const distinctIdents = new Set(hits.map((h) => `${h.type}|${h.v}`)).size;
      const distinctPhones = new Set(
        hits.filter((h) => h.type === 'phone').map((h) => h.v)
      ).size;
      const types = new Set(hits.map((h) => h.type));
      stats.pages_matched_any++;
      if (types.has('phone')) stats.pages_matched_phone++;
      if (types.has('domain')) stats.pages_matched_domain++;
      if (types.has('email')) stats.pages_matched_email++;
      if (types.has('instagram')) stats.pages_matched_ig++;
      if (hits.some((h) => h.src === 'extracted_text')) stats.matched_from_column++;
      if (hits.every((h) => h.src === 'spatial_tags.raw_text')) stats.matched_from_rawtext++;
      pagesByType.set(r.page_type || '(null)', (pagesByType.get(r.page_type || '(null)') || 0) + 1);

      // dedupe candidate rows on (org, type, value)
      const emitted = new Set();
      for (const h of hits) {
        for (const oid of h.ids) {
          const k = `${oid}|${h.type}|${h.v}`;
          if (emitted.has(k)) continue;
          emitted.add(k);
          matchedOrgs[h.type === 'instagram' ? 'ig' : h.type].add(oid);
          if (!orgPageSets.has(oid)) orgPageSets.set(oid, new Set());
          orgPageSets.get(oid).add(r.id);
          ws.write(JSON.stringify({
            org_id: oid,
            org_name: orgName.get(oid),
            page_id: r.id,
            publication_id: r.publication_id,
            page_number: r.page_number,
            identifier_type: h.type,
            matched_value: h.v,
            evidence_snippet: h.ev,
            text_source: h.src,
            page_type_column: r.page_type,
            page_type_from_tags: r.tag_page_type,
            other_org_ids_on_page: allOrgs.filter((x) => x !== oid),
            org_count_on_page: allOrgs.length,
            distinct_identifiers_on_page: distinctIdents,
            distinct_phones_on_page: distinctPhones,
            identifier_shared_by_n_orgs: h.ids.size,
            source_url: sourceUrl(r.publication_id, r.page_number),
          }) + '\n');
          stats.candidates++;
        }
      }
    }
    if (from % 5000 < BATCH) process.stderr.write(`  …${from} pages\n`);
    if (short) break;
  }

  await new Promise((res) => ws.end(res));

  const report = {
    run_at: new Date().toISOString(),
    out: OUT,
    orgs: orgStats,
    pages: stats,
    orgs_matched: {
      phone: matchedOrgs.phone.size,
      domain: matchedOrgs.domain.size,
      email: matchedOrgs.email.size,
      instagram: matchedOrgs.ig.size,
      union: new Set([...matchedOrgs.phone, ...matchedOrgs.domain, ...matchedOrgs.email, ...matchedOrgs.ig]).size,
      phone_only: [...matchedOrgs.phone].filter((x) =>
        !matchedOrgs.domain.has(x) && !matchedOrgs.email.has(x) && !matchedOrgs.ig.has(x)).length,
      domain_not_phone: [...matchedOrgs.domain].filter((x) => !matchedOrgs.phone.has(x)).length,
      email_not_phone: [...matchedOrgs.email].filter((x) => !matchedOrgs.phone.has(x)).length,
      ig_not_phone: [...matchedOrgs.ig].filter((x) => !matchedOrgs.phone.has(x)).length,
    },
    matched_pages_by_page_type_column: Object.fromEntries(
      [...pagesByType.entries()].sort((a, b) => b[1] - a[1])
    ),
  };
  console.log(JSON.stringify(report, null, 2));

}

main().catch((e) => { console.error(e); process.exit(1); });
