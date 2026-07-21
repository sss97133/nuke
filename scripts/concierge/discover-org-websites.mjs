#!/usr/bin/env node
// STAGE 0 of the concierge profile pipeline: establish WHERE an org lives on the web.
//
//   discover-org-websites.mjs  ->  classify-org-domains.mjs  ->  fill-org-profiles.mjs
//
// 916 St Barth orgs carry no website at all, which blocks description / logo / catalogue /
// contact fill for every one of them. This script finds the real web presence and writes
// ONLY the `website` column and `social_links` — never a description (that is the next
// stage's job, and it runs off the domain established here).
//
// Doctrine (AGENTS.md "FACTS ARE SACRED"; same standard as fill-org-profiles.mjs):
//   - Nothing is generated. A URL is stored only when a fetched page IDENTIFIES this org.
//   - Every datum carries (source, method, observed_at, trust).
//   - Columns are filled only when empty. An existing value is never overwritten; a
//     disagreement is recorded as a conflict, not resolved.
//   - Discovery demands a HIGHER bar than fill-org-profiles' gate, because there the URL
//     was already asserted by the directory and here we are asserting it ourselves. So a
//     page that merely NAMES the org is not enough: the host must carry the org's name, or
//     the page must carry the org's phone number. Otherwise -> NULL.
//
// Witnesses, cheapest first:
//   1. OpenStreetMap (Overpass, free)  — website/phone/IG/FB tags on island POIs
//   2. Firecrawl search                — "<name> Saint Barthelemy" etc.
//   3. Firecrawl scrape                — the entity gate on every candidate own-site
//
// Usage:
//   node scripts/concierge/discover-org-websites.mjs [--apply] [--limit N] [--tier N]
//   node scripts/concierge/discover-org-websites.mjs --report out.json --limit 40

import fs from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const db = createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FC = process.env.FIRECRAWL_API_KEY;
const APPLY = process.argv.includes('--apply');
const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const LIMIT = Number(arg('--limit', Infinity));
const TIER = arg('--tier', null);
const CONC = Number(process.env.CONC || 3);
const REPORT = arg('--report', '/tmp/discover-org-websites.json');
const OSM_CACHE = '/tmp/osm_stbarth.json';


// Gate primitives live in _org_entity_gate.mjs — ONE source of truth shared with
// audit-discovered-websites.mjs, so the rule that asserts a URL and the rule that
// re-adjudicates it can never drift apart.
import {
  decode, fold, compact, stripLegal, tokens, SBH, ISLAND_IN_HOST, isAggregator,
  GLOBAL_MAISON, LOCATOR_PATH, phoneKeys, islandPresence, islandSufficient,
  hostCore, nameCore, hostCarriesName, adjudicate, sameBusiness,
} from './_org_entity_gate.mjs';
// The host gate above says "is this the org's door". The guarded writer says
// "may this value be served" — including whether the page BODY still belongs to
// the org, which no host-level rule can answer.
import { guardedOrgWrite, pageEvidence, ADMITTED } from './_guarded_org_write.mjs';

// ---------- fetch ----------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fcPost(path, body, tries = 3) {
  for (let i = 0; i < tries; i++) {
    const r = await fetch(`https://api.firecrawl.dev/v2/${path}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${FC}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (r.status === 429 || r.status >= 500) { await sleep(3000 * (i + 1)); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j?.success) throw new Error(j?.error || `http ${r.status}`);
    return j;
  }
  throw new Error('firecrawl retries exhausted');
}

const search = async (q, limit = 6) => (await fcPost('search', { query: q, limit })).data?.web || [];

// Firecrawl reports slow/JS-heavy sites as a scrape timeout. Treating that as "unreachable"
// silently discards real evidence — carat-time.com (the correct site for CARAT ST BARTH) was
// lost this way in the dry run while a wrong IWC dealer page took its place. Always retry
// a timeout once, patiently.
async function scrape(url) {
  for (const [timeout, waitFor] of [[25000, 1500], [70000, 4000]]) {
    try {
      return (await fcPost('scrape', { url, formats: ['markdown', 'rawHtml', 'links'], onlyMainContent: false, timeout, waitFor })).data || {};
    } catch (e) {
      if (!/timed out|timeout/i.test(String(e.message)) || timeout > 60000) throw e;
    }
  }
  throw new Error('scrape timed out twice');
}

const metaOf = (html, keys) => {
  for (const k of keys) {
    const m = html.match(new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]+content=["']([^"']*)["']`, 'i'));
    if (m?.[1]) return m[1].trim();
  }
  return null;
};

// ---------- witness 1: OpenStreetMap ----------

async function loadOSM() {
  if (!fs.existsSync(OSM_CACHE)) {
    const q = '[out:json][timeout:180];(nwr["name"](17.85,-62.95,18.0,-62.75););out center tags;';
    const r = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST', body: new URLSearchParams({ data: q }),
    });
    fs.writeFileSync(OSM_CACHE, await r.text());
  }
  const els = JSON.parse(fs.readFileSync(OSM_CACHE, 'utf8')).elements || [];
  return els.filter((e) => e.tags?.name).map((e) => ({
    name: e.tags.name,
    namec: compact(e.tags.name),
    toks: tokens(e.tags.name),
    website: e.tags.website || e.tags['contact:website'] || null,
    phones: phoneKeys(e.tags.phone || e.tags['contact:phone']),
    instagram: e.tags['contact:instagram'] || null,
    facebook: e.tags['contact:facebook'] || null,
    osm: `${e.type}/${e.id}`,
  })).filter((e) => e.website || e.instagram || e.facebook);
}

function osmMatch(org, osm) {
  const on = tokens(org.name);
  const namec = compact(stripLegal(org.name));
  const oph = phoneKeys(org.phone);
  for (const e of osm) {
    const phoneHit = oph.length && e.phones.some((p) => oph.includes(p));
    const exact = namec.length >= 5 && (e.namec === namec || e.namec.includes(namec) || namec.includes(e.namec));
    const tokHit = on.length && e.toks.length
      && on.filter((t) => e.toks.includes(t)).length >= Math.max(1, Math.min(on.length, e.toks.length) >= 2 ? 2 : 1);
    // a phone match alone is conclusive; a name match alone must be an exact compacted hit
    if (phoneHit || exact || (tokHit && on.filter((t) => e.toks.includes(t)).length >= 2)) {
      return { ...e, basis: phoneHit ? 'osm_phone_match' : exact ? 'osm_name_exact' : 'osm_name_tokens', phoneHit };
    }
  }
  return null;
}

// ---------- witness 2: search-result classification ----------

const IG = /^https?:\/\/(?:www\.)?instagram\.com\/([A-Za-z0-9._]{2,30})\/?(?:\?|$)/i;
const FB = /^https?:\/\/(?:[a-z-]+\.)?facebook\.com\/(?:pg\/|pages\/[^/]+\/|p\/)?([A-Za-z0-9.\-]{3,60})\/?(?:\?|$)/i;
const HANDLE_JUNK = /^(p|pages|pg|people|profile|explore|reel|reels|tv|stories|accounts|login|share|sharer|home|help|about|privacy|policies|photo|video|watch|groups|events|marketplace|hashtag|search|permalink|story\.php|media)$/i;

function handleMatches(org, handle) {
  const h = compact(handle);
  if (h.length < 4) return null;
  const namec = compact(stripLegal(org.name));
  const on = tokens(org.name);
  // strip island suffixes that businesses append to their handle
  const hCore = h.replace(/(stbarth|stbarts|saintbarth|sbh|stbarthelemy|97133|officiel|official|_?sbh)$/g, '');
  if (namec.length >= 5 && (h === namec || hCore === namec || h.includes(namec))) return 'handle_exact';
  if (on.length >= 2 && on.filter((t) => h.includes(compact(t))).length >= 2) return 'handle_tokens';
  if (on.length === 1 && compact(on[0]).length >= 6 && h.includes(compact(on[0]))) return 'handle_token';
  return null;
}

function classify(org, results) {
  const socials = [];
  const sites = [];
  for (const r of results) {
    let host;
    try { host = new URL(r.url).hostname.replace(/^www\./, '').toLowerCase(); } catch { continue; }
    const blob = `${r.title || ''} ${r.description || ''}`;
    const sbh = SBH.test(blob);
    const oph = phoneKeys(org.phone);
    const phoneHit = oph.length && oph.some((p) => (blob.replace(/\D/g, '')).includes(p));

    // A social account is accepted on the search engine's INDEXED PROFILE TITLE — the
    // profile's own og:title ("Chamade Saint Barth (@chamadestbarth)"). Neither Firecrawl
    // nor a plain fetch can render an IG profile, so that title is the only witness there
    // is; it must therefore carry the island itself. An island mention buried in the
    // snippet DESCRIPTION is not enough — a Rome swimwear label listing a St Barth
    // stockist trips it (caught by hand-check on DELFINA).
    // Narrow exception: many island businesses carry a globally-unique Creole/invented name
    // (AKAZTIYAG, KIFETOU). When a handle is an EXACT compacted match of a name that long,
    // the handle itself is the identity evidence. Recorded as its own weaker basis so the
    // class stays visible and auditable rather than blending into the corroborated ones.
    const uniqueName = compact(stripLegal(org.name)).length >= 8;
    const island = (h, basis) => ISLAND_IN_HOST.test(h) || SBH.test(r.title || '') || phoneHit
      || (basis === 'handle_exact' && uniqueName);
    const islandBasis = (h, basis) => (ISLAND_IN_HOST.test(h) ? 'handle' : SBH.test(r.title || '') ? 'profile_title' : phoneHit ? 'phone' : basis === 'handle_exact' && uniqueName ? 'unique_name_exact' : null);

    const ig = r.url.match(IG);
    if (ig && !HANDLE_JUNK.test(ig[1])) {
      const basis = handleMatches(org, ig[1]);
      if (basis && island(ig[1], basis)) socials.push({ network: 'instagram', handle: ig[1], url: r.url, basis, sbh, island_basis: islandBasis(ig[1], basis), phoneHit, title: r.title });
      continue;
    }
    const fb = r.url.match(FB);
    if (fb && !HANDLE_JUNK.test(fb[1])) {
      const basis = handleMatches(org, fb[1]);
      if (basis && island(fb[1], basis)) socials.push({ network: 'facebook', handle: fb[1], url: r.url, basis, sbh, island_basis: islandBasis(fb[1], basis), phoneHit, title: r.title });
      continue;
    }
    if (isAggregator(host)) continue;
    sites.push({ url: r.url, host, title: r.title, description: r.description, sbh, phoneHit });
  }
  // rank candidate sites: host carrying the org name first, then phone corroboration
  const on = tokens(org.name);
  const namec = compact(stripLegal(org.name));
  const hostScore = (h) => {
    const hc = compact(h.replace(/\.[a-z.]+$/, ''));
    if (namec.length >= 5 && hc.includes(namec)) return 3;
    const hits = on.filter((t) => hc.includes(compact(t))).length;
    return hits >= 2 ? 3 : hits === 1 ? 2 : 0;
  };
  sites.sort((a, b) => (hostScore(b.host) + (b.phoneHit ? 1 : 0)) - (hostScore(a.host) + (a.phoneHit ? 1 : 0)));
  return { socials, sites: sites.map((s) => ({ ...s, hostScore: hostScore(s.host) })) };
}

// ---------- verification: fetch the candidate and gate it ----------

// Cheap pre-scrape rejections — never spend a crawl on a page that cannot be an own door.
function preReject(org, cand) {
  if (isAggregator(cand.host)) return { verdict: 'aggregator', reason: 'review site / directory / social network — a witness about the org, never its own door' };
  if (GLOBAL_MAISON.has(hostCore(cand.host))) return { verdict: 'global_maison', reason: 'worldwide brand site — cannot describe the island door' };
  let path = '/';
  try { path = new URL(cand.url).pathname; } catch { /* ranked earlier, url parses */ }
  if (LOCATOR_PATH.test(path)) return { verdict: 'stockist_locator', reason: `directory / dealer-locator entry on ${cand.host} — evidence about the org, not its own site` };
  if (!hostCarriesName(org.name, cand.host, true)) return { verdict: 'weak_title_only', reason: 'host does not carry the org name — a page about an org is not that org\'s door' };
  return null;
}

async function verify(org, cand) {
  const pre = preReject(org, cand);
  if (pre) return { ...cand, ...pre };
  let d;
  try { d = await scrape(cand.url); } catch (e) { return { ...cand, verdict: 'unreachable', reason: String(e.message || e).slice(0, 160) }; }
  const html = d.rawHtml || '';
  const md = d.markdown || '';
  const finalUrl = d.metadata?.sourceURL || d.metadata?.url || cand.url;
  const status = d.metadata?.statusCode ?? null;
  const title = (d.metadata?.title || metaOf(html, ['og:title']) || '').trim();

  const dead = (status && status >= 400)
    || /domain (is )?for sale|this domain|parked|under construction|site en construction|coming soon|account suspended|default web page|index of \//i.test(`${title} ${md.slice(0, 800)}`)
    || md.replace(/\s/g, '').length < 200;
  if (dead) return { ...cand, finalUrl, status, title, verdict: 'dead', reason: `HTTP ${status ?? '?'} / parked / empty page` };

  const oph = phoneKeys(org.phone);
  const digits = md.replace(/\D/g, '');
  const phoneOnPage = oph.length ? oph.some((p) => digits.includes(p)) : false;
  const fu = new URL(finalUrl);
  const island = islandPresence(md, fu.hostname);

  // THE DISCOVERY BAR — adjudicated by the shared gate, so this and the audit agree.
  const gate = adjudicate({
    orgName: org.name, host: fu.hostname.replace(/^www\./, '').toLowerCase(),
    path: fu.pathname, island, phoneOnPage,
  });
  const verdict = gate.verdict;
  const hostName = gate.host_carries_name ?? hostCarriesName(org.name, fu.hostname, phoneOnPage);

  // harvest socials off the confirmed page — the org's own links are the best handle source
  const soc = {};
  for (const u of [...(d.links || [])]) {
    if (/sharer|share\.php|intent\/|plugins|\/share/.test(String(u))) continue;
    const ig = String(u).match(/instagram\.com\/([A-Za-z0-9._]{2,30})/i);
    if (ig && !HANDLE_JUNK.test(ig[1]) && !soc.instagram) soc.instagram = ig[1];
    const fb = String(u).match(/facebook\.com\/(?:pg\/|p\/)?([A-Za-z0-9.\-]{3,60})/i);
    if (fb && !HANDLE_JUNK.test(fb[1]) && !soc.facebook) soc.facebook = fb[1];
  }

  return {
    ...cand, finalUrl, status, title, verdict, reason: gate.reason,
    host_carries_name: hostName, island_presence: island,
    phoneOnPage, socialsOnPage: Object.keys(soc).length ? soc : null,
    // The page BODY, carried forward to the write door. This gate adjudicates
    // the HOST; the guarded writer re-adjudicates the CONTENT, which is the
    // only thing that can catch a domain outliving its owner (BODY+SOUL ST
    // BARTH's lapsed domain, seized by a gambling site, satisfies every
    // host-level test here and always will). Truncated: the checks regex over
    // it and a whole site is waste.
    page_text: md.slice(0, 20000),
    // the org's own brand domain reached via a store page — correct door, but the page
    // speaks for the maison; flagged so the description stage does not inherit a global blurb
    brand_store_page: !!(hostName && LOCATOR_PATH.test(fu.pathname)),
  };
}

// ---------- load the work ----------

async function pagedOrgs(table, sel, build, key) {
  const out = []; let from = 0;
  for (;;) {
    const { data, error } = await build(db.from(table).select(sel)).order(key).range(from, from + 999);
    if (error) throw error;
    out.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return out;
}

const CAT_RANK = { retail: 0, dining_nightlife: 1, experience: 2, villa: 3, provisioning: 4, transport: 5, home_services: 6, infrastructure: 7 };

const view = await pagedOrgs('v_org_authentication', 'org_id,relevance_tier,concierge_category', (q) => q, 'org_id');
const vmap = new Map(view.map((v) => [v.org_id, v]));
const orgs = (await pagedOrgs('organizations', 'id,name,website,phone,address,city,social_links,metadata,enrichment_sources',
  (q) => q.eq('metadata->>project', 'lofficiel-concierge').is('website', null), 'id'))
  .map((o) => ({ ...o, name: decode(o.name), tier: vmap.get(o.id)?.relevance_tier ?? 9, cat: vmap.get(o.id)?.concierge_category || 'unknown' }))
  .filter((o) => (TIER ? String(o.tier) === String(TIER) : true))
  .sort((a, b) => (a.tier - b.tier) || ((CAT_RANK[a.cat] ?? 9) - (CAT_RANK[b.cat] ?? 9)) || a.name.localeCompare(b.name))
  .slice(0, LIMIT);

console.error(`orgs missing a website: ${orgs.length} queued  (apply=${APPLY})`);
const osm = await loadOSM();
console.error(`OSM island POIs carrying a web presence: ${osm.length}`);

// ---------- run ----------

const out = [];
const tally = { osm_site: 0, site: 0, instagram: 0, facebook: 0, none: 0, held_weak: 0, held_gate: 0, held_locator: 0, held_no_island: 0, dead: 0, error: 0, conflict: 0, phone_corroborated: 0 };

async function handle(org) {
  const observed_at = new Date().toISOString();
  const rec = { id: org.id, name: org.name, tier: org.tier, cat: org.cat, phone: org.phone, website: null, socials: {}, evidence: [], held: [] };

  // --- witness 1: OSM ---
  const hit = osmMatch(org, osm);
  if (hit?.website) {
    let host = null;
    try { host = new URL(hit.website).hostname.replace(/^www\./, ''); } catch { /* bad tag */ }
    if (host && !isAggregator(host)) {
      const v = await verify(org, { url: hit.website, host, title: hit.name, source: 'openstreetmap' });
      rec.evidence.push({ witness: 'openstreetmap', osm_id: hit.osm, basis: hit.basis, ...v });
      if (v.verdict === 'own_site') { rec.website = v.finalUrl; rec.website_witness = 'openstreetmap'; tally.osm_site++; }
      else rec.held.push({ url: hit.website, verdict: v.verdict, reason: v.reason });
    }
  }
  if (hit?.instagram) rec.socials.instagram ??= String(hit.instagram).replace(/^.*instagram\.com\//, '').replace(/\/.*$/, '');
  if (hit?.facebook) rec.socials.facebook ??= String(hit.facebook).replace(/^.*facebook\.com\//, '').replace(/\/.*$/, '');

  // --- witness 2: search ---
  if (!rec.website || !Object.keys(rec.socials).length) {
    const queries = [`${stripLegal(org.name)} Saint Barthelemy`];
    let results = [];
    try { results = await search(queries[0]); } catch (e) { rec.error = String(e.message || e).slice(0, 160); tally.error++; }
    if (!results.length && !rec.error) {
      try { results = await search(`${stripLegal(org.name)} St Barth`); } catch { /* one retry shape is enough */ }
    }
    const { socials, sites } = classify(org, results);
    rec.searched = results.length;

    for (const s of socials) {
      if (!rec.socials[s.network]) {
        rec.socials[s.network] = s.handle;
        rec.evidence.push({ witness: 'firecrawl_search', network: s.network, handle: s.handle, url: s.url, name_basis: s.basis, island_basis: s.island_basis, phone_in_snippet: s.phoneHit, profile_title: s.title });
      }
    }

    if (!rec.website) {
      // Only a host that already carries the org's name can clear the discovery bar, so
      // never spend a crawl on one that cannot. (Firecrawl serialises scrapes at 2 —
      // scrapes, not searches, are the throughput ceiling on a 916-org sweep.)
      const worth = [];
      for (const cand of sites) {
        if (hostCarriesName(org.name, cand.host)) worth.push(cand);
        else rec.held.push({ url: cand.url, verdict: 'no_name_in_host', reason: 'search hit does not carry the org name in its domain — a page about an org is not that org\'s door' });
      }
      tally.held_gate += sites.length - worth.length;
      for (const cand of worth.slice(0, 2)) {
        const v = await verify(org, { ...cand, source: 'firecrawl_search' });
        rec.evidence.push({ witness: 'firecrawl_search+scrape', ...v });
        if (v.verdict === 'own_site') {
          rec.website = v.finalUrl; rec.website_witness = 'firecrawl_search';
          rec.website_proof = { host_carries_name: v.host_carries_name, island_presence: v.island_presence, phone_corroborated: v.phoneOnPage, title: v.title, brand_store_page: v.brand_store_page };
          // kept off `rec` (which is serialised whole into the report) — the
          // page body is evidence for the gate, not a 20KB report column
          rec.__gate_evidence = { url: v.finalUrl, text: v.page_text, island: v.island_presence, phone_on_page: v.phoneOnPage };
          tally.site++;
          if (v.phoneOnPage) tally.phone_corroborated++;
          if (v.socialsOnPage) for (const [k, h] of Object.entries(v.socialsOnPage)) rec.socials[k] ??= h;
          break;
        }
        rec.held.push({ url: cand.url, verdict: v.verdict, reason: v.reason || v.verdict });
        if (v.verdict === 'weak_title_only') tally.held_weak++;
        else if (v.verdict === 'dead') tally.dead++;
        else if (v.verdict === 'stockist_locator') tally.held_locator++;
        else if (v.verdict === 'no_island_presence') tally.held_no_island++;
        else tally.held_gate++;
      }
    }
  }

  if (rec.socials.instagram) tally.instagram++;
  if (rec.socials.facebook) tally.facebook++;
  if (!rec.website && !Object.keys(rec.socials).length) tally.none++;
  rec.observed_at = observed_at;
  out.push(rec);
  // Always adjudicate; write only under --apply. The dry run is now informative
  // rather than silent — the only way to see a gate's effect before trusting it
  // with the column. No CLI flag changed; nothing writes without --apply.
  if (rec.website || Object.keys(rec.socials).length) await write(org, rec);
}

async function write(org, rec) {
  const { data: cur, error } = await db.from('organizations')
    .select('id, name, website, social_links, metadata, enrichment_sources, latitude, longitude, city, country').eq('id', org.id).single();
  if (error) { console.error('READ FAIL', org.name, error.message); return; }

  const block = {
    observed_at: rec.observed_at,
    method: 'overpass+firecrawl_search+entity_gate',
    script: 'scripts/concierge/discover-org-websites.mjs',
    website: rec.website, website_witness: rec.website_witness || null,
    socials: Object.keys(rec.socials).length ? rec.socials : null,
    evidence: rec.evidence, held: rec.held,
    trust: rec.website_witness === 'openstreetmap' ? 'osm_corroborated_site' : rec.website ? 'search_corroborated_site' : null,
  };
  const upd = { metadata: { ...(cur.metadata || {}), web_discovery: block }, last_enriched_at: rec.observed_at };

  // ── SERVED FACT COLUMNS — offered to the gate, never written here ────────
  // fill-only-empty. A stored value is never overwritten; a disagreement is a conflict.
  const offered = [];
  const prov = {
    source: rec.website_witness === 'openstreetmap' ? 'openstreetmap' : 'firecrawl_search',
    source_url: rec.website || null,
    observed_at: rec.observed_at,
    method: 'overpass+firecrawl_search+entity_gate',
    trust: block.trust,
  };
  if (rec.website) {
    if (!cur.website) offered.push({ ...prov, field: 'website', value: rec.website });
    else if (compact(cur.website) !== compact(rec.website)) block.conflict = { stored: cur.website, discovered: rec.website };
  }
  const soc = { ...(cur.social_links || {}) };
  let socChanged = false;
  for (const [k, v] of Object.entries(rec.socials)) {
    if (!soc[k]) { soc[k] = v; socChanged = true; }
    else if (compact(soc[k]) !== compact(v)) { (block.social_conflicts ??= {})[k] = { stored: soc[k], discovered: v }; }
  }
  if (socChanged) {
    offered.push({
      ...prov, field: 'social_links',
      value: { ...soc, _source: 'web_discovery', _method: 'firecrawl_search+osm', _observed_at: rec.observed_at },
      supersede: !!(cur.social_links && Object.keys(cur.social_links).length),
    });
  }

  // The evidence is the page this run actually scraped. `island` is the SIGNAL
  // STRING from islandPresence() — the same value this script's own adjudicate()
  // consumed — so the two gates judge the same fact, never two different types
  // of it. When the witness was OSM there was no scrape and no body: the gate is
  // told there is no page text rather than handed an empty one.
  // STEP 1: adjudicate the served fields. No sidecar yet — its content depends
  // on the outcome, and `block` is serialised BY VALUE into metadata, so a
  // write_gate stamped after the sidecar landed would never reach the row.
  const gate = await guardedOrgWrite({
    org: cur,
    fields: offered,
    evidence: rec.__gate_evidence
      ? pageEvidence(rec.__gate_evidence)
      : pageEvidence({ url: rec.website || null }),
    apply: APPLY,
  });

  // STEP 2: the bookkeeping, carrying the verdict — so a website column left
  // empty reads as "held, and here is the reason" rather than "nothing found".
  block.write_gate = {
    offered: offered.map((o) => o.field),
    admitted: gate.admitted,
    held: Object.fromEntries(Object.entries(gate.decisions)
      .filter(([, r]) => !ADMITTED(r) && r.action !== 'skipped')
      .map(([k, r]) => [k, { action: r.action, severity: r.severity, reason: String(r.reason || '').slice(0, 400) }])),
  };
  const srcs = new Set(cur.enrichment_sources || []);
  srcs.add('web-discovery');
  if (rec.website_witness === 'openstreetmap') srcs.add('openstreetmap');
  upd.enrichment_sources = [...srcs];
  if (gate.admitted.length) upd.enrichment_status = 'enriched';
  upd.metadata.web_discovery = block;

  // mergeDecisions: step 1's quarantine/quality records live in the row now;
  // this metadata write was built from a read taken before them and would
  // clobber them silently. Merging is the only way both survive.
  const side = await guardedOrgWrite({ org: cur, fields: [], sidecar: upd, apply: APPLY, mergeDecisions: gate.decisions });

  for (const [fld, r] of Object.entries(gate.decisions)) {
    if (ADMITTED(r) || r.action === 'skipped') continue;
    tally.gate_held = (tally.gate_held || 0) + 1;
    console.error(`   HELD ${fld.padEnd(14)} ${String(org.name).slice(0, 28).padEnd(30)} [${r.action}/${r.severity}] ${String(r.reason).slice(0, 140)}`);
  }
  if (side.sidecar_error) console.error('WRITE FAIL', org.name, side.sidecar_error);
  else if (block.conflict) tally.conflict++;
}

let done = 0;
const q = [...orgs];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (q.length) {
    const org = q.shift();
    try { await handle(org); } catch (e) { console.error('FAIL', org.name, String(e.message || e).slice(0, 120)); tally.error++; }
    if (++done % 20 === 0) console.error(`[${done}/${orgs.length}] site=${tally.osm_site + tally.site} ig=${tally.instagram} fb=${tally.facebook} none=${tally.none}`);
  }
}));

fs.writeFileSync(REPORT, JSON.stringify(out, null, 2));
console.error('\n=== DISCOVERY YIELD ===');
console.error(`queued ${orgs.length}`);
console.error(`website established : ${tally.osm_site + tally.site}  (osm ${tally.osm_site} · search ${tally.site}) — ${tally.phone_corroborated} phone-corroborated`);
console.error(`instagram handle    : ${tally.instagram}`);
console.error(`facebook page       : ${tally.facebook}`);
console.error(`nothing found       : ${tally.none}`);
console.error(`held (deliberate NULL): weak-title ${tally.held_weak} · not-own-domain ${tally.held_gate} · stockist-locator ${tally.held_locator} · no-island-presence ${tally.held_no_island} · dead/parked ${tally.dead}`);
console.error(`errors ${tally.error} · conflicts ${tally.conflict}`);
console.error(`report -> ${REPORT}`);
