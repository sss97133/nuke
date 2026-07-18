// pubfeat-lib.mjs — shared library for the publication_features → organizations
// entity-resolution pipeline (Guest Book 2024 advertiser linking).
//
// Dependency-free: uses Node's native fetch against PostgREST directly, so the
// pipeline runs without a root node_modules install. Semantics mirror
// seed-publications.mjs (service-role key, batch writes of 50, guarded updates).
//
// Env (source ~/.nuke_env): VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import fs from 'node:fs';
import path from 'node:path';

// ── PostgREST client ────────────────────────────────────────────────────────

export function restClient() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('Missing VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (source ~/.nuke_env)');
    process.exit(1);
  }
  const base = `${url.replace(/\/$/, '')}/rest/v1`;
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
  };

  async function request(method, pathAndQuery, { body, prefer } = {}) {
    const h = { ...headers };
    if (prefer) h.Prefer = prefer;
    const res = await fetch(`${base}/${pathAndQuery}`, {
      method,
      headers: h,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`${method} ${pathAndQuery} → ${res.status}: ${text.slice(0, 500)}`);
    }
    return text ? JSON.parse(text) : null;
  }

  return {
    // Paginated GET of every row matching the query.
    async getAll(table, query, pageSize = 1000) {
      const rows = [];
      for (let offset = 0; ; offset += pageSize) {
        const sep = query ? '&' : '';
        const page = await request(
          'GET',
          `${table}?${query}${sep}limit=${pageSize}&offset=${offset}`
        );
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return rows;
    },
    async count(table, query) {
      const sep = query ? '&' : '';
      const res = await fetch(`${base}/${table}?${query}${sep}select=*`, {
        method: 'HEAD',
        headers: { ...headers, Prefer: 'count=exact', Range: '0-0' },
      });
      const range = res.headers.get('content-range') || '';
      return parseInt(range.split('/')[1], 10);
    },
    patch: (table, query, body, prefer = 'return=representation') =>
      request('PATCH', `${table}?${query}`, { body, prefer }),
    insert: (table, rows, prefer = 'return=representation') =>
      request('POST', table, { body: rows, prefer }),
    delete: (table, query, prefer = 'return=representation') =>
      request('DELETE', `${table}?${query}`, { prefer }),
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Normalizers ─────────────────────────────────────────────────────────────

// Phone → set of E.164 +590XXXXXXXXX strings.
// St Barth uses Guadeloupe numbering: landlines 0590…, mobiles 0690/0691….
export function normalizePhones(raw) {
  const out = new Set();
  if (!raw || typeof raw !== 'string') return out;
  for (const token of raw.split(/\s*(?:\/|,|;|·|\bou\b|\bor\b)\s*/i)) {
    let digits = token.replace(/[^\d+]/g, '');
    if (!digits) continue;
    if (digits.startsWith('+590')) digits = digits.slice(4);
    else if (digits.startsWith('00590')) digits = digits.slice(5);
    else if (digits.startsWith('590') && digits.length > 9) digits = digits.slice(3);
    else if (digits.startsWith('0') && digits.length === 10) digits = digits.slice(1);
    digits = digits.replace(/\D/g, '');
    if (digits.length === 9 && /^[56]9[01]/.test(digits)) out.add(`+590${digits}`);
    // Keep other 9-digit French-form numbers too (rare metropolitan-format ads)
    else if (digits.length === 9) out.add(`+590${digits}`);
  }
  return out;
}

const IG_STOPLIST = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'tv']);

// Instagram URL or @handle → lowercase handle, or null.
export function normalizeInstagram(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const url = raw.match(/instagram\.com\/([a-zA-Z0-9_.]+)/i);
  let handle = url ? url[1] : null;
  if (!handle) {
    const at = raw.trim().match(/^@?([a-zA-Z0-9_.]{2,30})$/);
    handle = at ? at[1] : null;
  }
  if (!handle) return null;
  handle = handle.toLowerCase().replace(/[./]+$/, '');
  return IG_STOPLIST.has(handle) ? null : handle;
}

const PLATFORM_HOSTS = new Set([
  'wixsite.com', 'business.site', 'facebook.com', 'instagram.com',
  'linktr.ee', 'squarespace.com', 'google.com', 'youtube.com', 'wordpress.com',
]);
const FREEMAIL = new Set([
  'gmail.com', 'hotmail.com', 'hotmail.fr', 'yahoo.com', 'yahoo.fr',
  'outlook.com', 'outlook.fr', 'orange.fr', 'wanadoo.fr', 'icloud.com', 'live.com',
]);

// Website URL (or email for fromEmail=true) → naive eTLD+1, or null.
export function normalizeDomain(raw, { fromEmail = false } = {}) {
  if (!raw || typeof raw !== 'string') return null;
  let host = raw.trim().toLowerCase();
  if (fromEmail) {
    const at = host.lastIndexOf('@');
    if (at === -1) return null;
    host = host.slice(at + 1);
  } else {
    host = host.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
  }
  if (!host || !host.includes('.')) return null;
  const parts = host.split('.');
  // naive eTLD+1 with a couple of common two-part TLDs
  const twoPart = new Set(['co.uk', 'com.fr', 'wixsite.com', 'business.site']);
  const lastTwo = parts.slice(-2).join('.');
  const domain = twoPart.has(lastTwo) && parts.length >= 3 ? parts.slice(-3).join('.') : lastTwo;
  if (PLATFORM_HOSTS.has(domain)) return null;
  if (fromEmail && FREEMAIL.has(domain)) return null;
  return domain;
}

const LEGAL_SUFFIXES = /\b(sarl|sasu|sas|snc|eurl|sci|sa|sc|ltd|inc|co|llc)\b\.?$/;
const ISLAND_QUALIFIERS = /\b(st\.?\s*barth(elemy|s)?|saint\s*barth(elemy|s)?|sbh)\b/g;

export function normalizeName(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let s = raw
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bet\b/g, 'and')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  s = s.replace(LEGAL_SUFFIXES, '').trim();
  return s || null;
}

export function nameVariants(raw) {
  const base = normalizeName(raw);
  if (!base) return [];
  const variants = new Set([base]);
  const noArticle = base.replace(/^(le|la|les|l)\s+/, '').trim();
  if (noArticle) variants.add(noArticle);
  const noIsland = base.replace(ISLAND_QUALIFIERS, '').replace(/\s+/g, ' ').trim();
  if (noIsland) variants.add(noIsland);
  const noBoth = noArticle.replace(ISLAND_QUALIFIERS, '').replace(/\s+/g, ' ').trim();
  if (noBoth) variants.add(noBoth);
  return [...variants].filter(Boolean);
}

// ── Similarity ──────────────────────────────────────────────────────────────

function trigrams(s) {
  const padded = `  ${s} `;
  const grams = new Set();
  for (let i = 0; i < padded.length - 2; i++) grams.add(padded.slice(i, i + 3));
  return grams;
}

export function trigramSim(a, b) {
  if (!a || !b) return 0;
  const ta = trigrams(a);
  const tb = trigrams(b);
  let inter = 0;
  for (const g of ta) if (tb.has(g)) inter++;
  return inter / (ta.size + tb.size - inter);
}

export function tokenSetSim(a, b) {
  if (!a || !b) return 0;
  const sa = new Set(a.split(' '));
  const sb = new Set(b.split(' '));
  let inter = 0;
  for (const t of sa) if (sb.has(t)) inter++;
  return inter / Math.max(sa.size, sb.size);
}

export const nameSim = (a, b) => Math.max(trigramSim(a, b), tokenSetSim(a, b));

// ── Feature + org field extraction ──────────────────────────────────────────

export function featureKeys(f) {
  const d = f.details || {};
  return {
    phones: normalizePhones(d.phone),
    instagram: normalizeInstagram(d.instagram),
    domains: new Set(
      [
        normalizeDomain(d.website),
        normalizeDomain(d.email, { fromEmail: true }),
      ].filter(Boolean)
    ),
    names: nameVariants(f.org_name_printed),
  };
}

export function orgKeys(o) {
  const md = o.metadata || {};
  const facts = md.access_sb?.facts || {};
  const phones = new Set([
    ...normalizePhones(o.phone),
    ...normalizePhones(typeof facts.phone === 'string' ? facts.phone : ''),
  ]);
  const domains = new Set(
    [
      normalizeDomain(o.website),
      normalizeDomain(o.email, { fromEmail: true }),
      normalizeDomain(typeof facts.email === 'string' ? facts.email : '', { fromEmail: true }),
    ].filter(Boolean)
  );
  const names = [
    ...new Set([...nameVariants(o.business_name), ...nameVariants(o.name)]),
  ];
  return {
    phones,
    instagram: normalizeInstagram(md.instagram),
    domains,
    names,
  };
}

// Completeness score — tiebreaker idiom from scripts/concierge/dedupe-businesses.ts
export function completenessScore(o) {
  const md = o.metadata || {};
  let s = 0;
  if (o.website) s += 10;
  if (o.phone) s += 5;
  if (o.email) s += 5;
  if (md.instagram) s += 20;
  if (md.facebook) s += 10;
  if (md.investigated_at) s += 15;
  s += Object.keys(md).length;
  return s;
}

// ── Org index ───────────────────────────────────────────────────────────────

export function buildOrgIndex(orgs) {
  const byPhone = new Map();
  const byInstagram = new Map();
  const byDomain = new Map();
  const byName = new Map();
  const keyed = [];

  const push = (map, key, id) => {
    if (!map.has(key)) map.set(key, new Set());
    map.get(key).add(id);
  };

  for (const o of orgs) {
    const k = orgKeys(o);
    keyed.push({ org: o, keys: k });
    for (const p of k.phones) push(byPhone, p, o.id);
    if (k.instagram) push(byInstagram, k.instagram, o.id);
    for (const d of k.domains) push(byDomain, d, o.id);
    for (const n of k.names) push(byName, n, o.id);
  }
  return { byPhone, byInstagram, byDomain, byName, keyed, byId: new Map(orgs.map((o) => [o.id, o])) };
}

// Top-K candidate shortlist for a feature: name similarity ranked, with forced
// inclusion of any contact-key sharer; ordered by (sim, completeness).
export function shortlist(feature, index, K = 8) {
  const fk = featureKeys(feature);
  const forced = new Set();
  for (const p of fk.phones) for (const id of index.byPhone.get(p) || []) forced.add(id);
  if (fk.instagram) for (const id of index.byInstagram.get(fk.instagram) || []) forced.add(id);
  for (const d of fk.domains) for (const id of index.byDomain.get(d) || []) forced.add(id);

  const scored = index.keyed.map(({ org, keys }) => {
    let best = 0;
    for (const fn of fk.names) for (const on of keys.names) best = Math.max(best, nameSim(fn, on));
    return { org, keys, sim: best };
  });
  scored.sort(
    (a, b) => b.sim - a.sim || completenessScore(b.org) - completenessScore(a.org)
  );

  const picked = [];
  const seen = new Set();
  for (const id of forced) {
    const entry = scored.find((s) => s.org.id === id);
    if (entry && !seen.has(id)) {
      picked.push(entry);
      seen.add(id);
    }
  }
  for (const entry of scored) {
    if (picked.length >= K) break;
    if (!seen.has(entry.org.id) && entry.sim > 0.15) {
      picked.push(entry);
      seen.add(entry.org.id);
    }
  }
  return picked.map(({ org, keys, sim }) => ({
    id: org.id,
    business_name: org.business_name,
    name: org.name,
    entity_type: org.entity_type,
    phones: [...keys.phones],
    instagram: keys.instagram,
    domains: [...keys.domains],
    address: org.address,
    city: org.city,
    category_fr: org.metadata?.category_fr ?? null,
    super_category: org.metadata?.super_category ?? null,
    name_sim: Number(sim.toFixed(3)),
    completeness: completenessScore(org),
  }));
}

// ── Deterministic matcher ───────────────────────────────────────────────────
// Returns {decision, method, evidence} — decision is an org id, 'AMBIGUOUS', or null.
// Auto-accept requires the key value to be UNIQUE in the index and no other key
// to contradict it. Any collision demotes to AMBIGUOUS (LLM tier).

export function deterministicMatch(feature, index) {
  const fk = featureKeys(feature);
  const hits = []; // {key, value, orgIds}

  if (fk.instagram) {
    const ids = index.byInstagram.get(fk.instagram);
    if (ids) hits.push({ key: 'instagram', value: fk.instagram, orgIds: [...ids] });
  }
  for (const d of fk.domains) {
    const ids = index.byDomain.get(d);
    if (ids) hits.push({ key: 'domain', value: d, orgIds: [...ids] });
  }
  for (const p of fk.phones) {
    const ids = index.byPhone.get(p);
    if (ids) hits.push({ key: 'phone', value: p, orgIds: [...ids] });
  }
  for (const n of fk.names) {
    const ids = index.byName.get(n);
    if (ids) hits.push({ key: 'name', value: n, orgIds: [...ids] });
  }

  if (!hits.length) return { decision: null, method: null, evidence: [] };

  // Union of every org implicated by any key
  const allIds = new Set(hits.flatMap((h) => h.orgIds));
  if (allIds.size === 1) {
    const id = [...allIds][0];
    const uniqueHit = hits.find((h) => h.orgIds.length === 1);
    if (uniqueHit) {
      return {
        decision: id,
        method: uniqueHit.key,
        evidence: hits.map((h) => `${h.key}=${h.value}`),
      };
    }
  }
  return {
    decision: 'AMBIGUOUS',
    method: null,
    evidence: hits.map((h) => `${h.key}=${h.value}→${h.orgIds.length} orgs`),
  };
}

// ── Run-dir + snapshot helpers ──────────────────────────────────────────────

export function runDir(existing) {
  const base = path.join(import.meta.dirname, 'data');
  if (existing) {
    const p = path.isAbsolute(existing) ? existing : path.join(base, existing);
    if (!fs.existsSync(p)) {
      console.error(`Run dir not found: ${p}`);
      process.exit(1);
    }
    return p;
  }
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const p = path.join(base, `pubfeat-run-${ts}`);
  fs.mkdirSync(p, { recursive: true });
  return p;
}

export function latestRunDir() {
  const base = path.join(import.meta.dirname, 'data');
  const runs = fs
    .readdirSync(base)
    .filter((d) => d.startsWith('pubfeat-run-'))
    .sort();
  if (!runs.length) {
    console.error('No pubfeat-run-* dir found under scripts/stbarth/data/');
    process.exit(1);
  }
  return path.join(base, runs[runs.length - 1]);
}

export const readJson = (dir, name) =>
  JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
export const writeJson = (dir, name, obj) =>
  fs.writeFileSync(path.join(dir, name), JSON.stringify(obj, null, 2));
