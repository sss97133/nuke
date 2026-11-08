#!/usr/bin/env node
// Place exemplars: for each organization, a few reference photos of the PLACE (its lot, showroom or shop), built automatically from
// evidence already in the system, so scripts/garage/match-places.mjs can ask "which of these known places is this photo session
// taken at, or neither". An exemplar is a cited reference, not a fact about any vehicle; no organization name is an input to the viewer.
//
//   node scripts/garage/build-place-exemplars.mjs --sessions-json /workspace/scene_sessions.json
//        [--history-jsonl /workspace/bat_history.jsonl] [--aliases-json f.json | --from-aliases]
//        [--labels-jsonl /workspace/scene_labels.jsonl] [--out /workspace/place_exemplars.json]
//        [--cache-dir /workspace/bat-cache] [--delay-ms 1000] [--max-per-org 6] [--bat-listings-per-org 4]
//        [--garage-vins-json f.json] [--min-vin-exemplars 4] [--exclude-vehicles-json f.json] [--prefer-sources vin_matched_session,scene_session,bat_listing]
//
// Organizations come from the sessions file (its `organizations` lists: id, name, business_type; same normalized name = one place).
// (a) BaT: the organization's own listings (history JSONL rows from ingest-bat-seller-history.mjs whose seller handle is an
//     org_seller_aliases alias of the organization; --aliases-json is [{organization_id, seller_username}] or --from-aliases reads the
//     table through PostgREST with SUPABASE_SERVICE_ROLE_KEY): each listing page is fetched (cache /workspace/bat-cache, the same
//     `listing-<slug>.html` files the history ingest writes; 1 request per second), its gallery (data-gallery-items) is read and a few
//     WIDE shots from the front of the gallery are kept (BaT galleries open with exterior shots, which a dealer takes on its own lot).
// (b) scene sessions already at the organization: label rows (--labels-jsonl, confidence >= 0.85) whose session is in range of exactly
//     one organization, or whose label reads shop (shop_interior / upholstery_work / paint_body) and the session is in range of exactly
//     one shop-kind organization. One sample photo per such session.
// (c) vin_matched_session: a garage vehicle (--garage-vins-json, [{id, vin}]) whose upper-case VIN equals the VIN of one of the organization's
//     BaT history rows (the same alias-resolved rows as (a)) was sold by that organization, so its own scene sessions (--sessions-json) show
//     the place. ONLY sessions labelled dealer_lot or showroom in --labels-jsonl are used (DEALER_LABELS), whatever the session's range;
//     there is no shop/outdoor fallback. One sample photo per session, at most 2 exemplars per source vehicle,
//     cite {vehicle_id, session_key, vin, listing_url, source}. --exclude-vehicles-json (array of vehicle ids or id prefixes) names vehicles
//     never used as an exemplar source (any of the three sources).
//     Cross-organization exclusion: a vehicle VIN-matched to organization X is never an exemplar source (any source) for another organization.
//     Mixed fallback: an organization with fewer than --min-vin-exemplars (default 4) vin_matched_session exemplars gets its remaining
//     --max-per-org slots filled with its bat_listing exemplars, after the vin ones.
// Output: JSON [{org_id, org_name, org_kind, exemplars:[{url, source:'bat_listing'|'scene_session'|'vin_matched_session', cite}]}], up to
// --max-per-org each. Without --prefer-sources, vin_matched_session fill first and BaT and scene exemplars are interleaved after them (BaT
// and scene alone are interleaved, BaT first). With --prefer-sources (comma list) the sources fill the cap in that order; bat_listing
// is always placed after vin_matched_session when the organization has any (and see the mixed fallback above). Read-only; nothing is written to a database.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { listingSlug } from './ingest-bat-seller-history.mjs';

const UA = 'Mozilla/5.0';
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SHOP_LABELS = ['shop_interior', 'upholstery_work', 'paint_body'];
export const DEALER_LABELS = ['dealer_lot', 'showroom'];

// ---- pure helpers (tested) -------------------------------------------------------------------------------------------------

// Mirror of the preview's organization kind: business_type decides; 'dealer' (dealer / auction / consign) or 'shop'
// (restoration / upholstery / body shop / paint / fabrication / garage / builder / mechanic); both or neither -> null.
export function orgKind(businessType) {
  const t = String(businessType ?? '').toLowerCase();
  const d = /(dealer|auction|consign)/.test(t); const s = /(restor|upholster|body_shop|body shop|paint|fabricat|garage|builder|mechanic)/.test(t);
  return d && !s ? 'dealer' : s && !d ? 'shop' : null;
}

export const normName = (n) => String(n ?? '').toLowerCase().replace(/['’`]/g, '').replace(/[^a-z0-9]+/g, ' ')
  .replace(/\b(custom|llc|inc|incorporated|corp|co|ltd|the)\b/g, ' ').replace(/\s+/g, ' ').trim();

// Distinct places in a session's organizations list (same normalized name counts once; the first id represents it).
// `rep` (name key -> id) makes the representative id the same across sessions.
export function distinctOrgs(orgs, rep = null) {
  const seen = new Map();
  for (const o of orgs ?? []) { if (!o?.id) continue; const k = normName(o.name) || o.id; if (!seen.has(k)) seen.set(k, rep?.get(k) ? { ...o, id: rep.get(k) } : o); }
  return [...seen.values()];
}

// name key -> the smallest id seen under that name, over all sessions
export function representatives(sessions) {
  const rep = new Map();
  for (const s of sessions) for (const o of s.organizations ?? []) { if (!o?.id) continue; const k = normName(o.name) || o.id; if (!rep.has(k) || o.id < rep.get(k)) rep.set(k, o.id); }
  return rep;
}

// Gallery items of a BaT listing page: [{url, width, height}] in page order (large size).
export function parseGallery(html) {
  const m = String(html ?? '').match(/data-gallery-items="([^"]*)"/);
  if (!m) return [];
  let items;
  try {
    const raw = m[1].replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#0?38;|&amp;/g, '&');
    items = JSON.parse(raw);
  } catch { return []; }
  const out = [];
  for (const it of Array.isArray(items) ? items : []) {
    const url = it?.large?.url ?? it?.full?.url ?? it?.small?.url;
    const w = Number(it?.large?.width ?? String(it?.dimensions ?? '').split('x')[0]);
    const h = Number(it?.large?.height ?? String(it?.dimensions ?? '').split('x')[1]);
    if (typeof url === 'string' && /^https?:\/\//.test(url) && w > 0 && h > 0) out.push({ url: url.replace(/\\\//g, '/'), width: w, height: h });
  }
  return out;
}

// A few wide shots from the front of the gallery (exteriors come first): landscape (ratio >= 1.4), at least 1000 px wide, from the first
// `window` photos, spread over that window. The pick is a heuristic; the viewer judges what it shows.
export function pickWide(items, n = 2, window = 12) {
  const wide = items.slice(0, window).filter((x) => x.width >= 1000 && x.width / x.height >= 1.4);
  if (wide.length <= n) return wide;
  const step = (wide.length - 1) / (n - 1 || 1);
  return Array.from({ length: n }, (_, i) => wide[Math.round(i * step)]);
}

const sampleUrl = (s) => (s.sample_urls ?? s.sample_image_urls ?? (s.samples ?? []).map((x) => x?.image_url)).find((u) => typeof u === 'string' && u);
const normVin = (v) => String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const isExcluded = (vehicleId, exclude) => (exclude ?? []).some((p) => p && String(vehicleId ?? '').toLowerCase().startsWith(String(p).toLowerCase()));

const placeKey = (o) => normName(o?.name) || o?.id;

// Which place(s) a garage vehicle was sold by: Map(vehicle id -> Set(place key)), from VIN equality with each organization's BaT history rows.
export function vinOwners(orgs, listingsByOrg, garageVins, { minVinLength = 9 } = {}) {
  const byVin = new Map();
  for (const g of garageVins ?? []) { const v = normVin(g?.vin); if (g?.id && v.length >= minVinLength) (byVin.get(v) ?? byVin.set(v, new Set()).get(v)).add(g.id); }
  const owners = new Map();
  for (const o of orgs) for (const r of listingsByOrg.get(o.id) ?? []) for (const vid of byVin.get(normVin(r.vin)) ?? []) (owners.get(vid) ?? owners.set(vid, new Set()).get(vid)).add(placeKey(o));
  return owners;
}
// true when the vehicle is VIN-matched to places and `org` is not one of them
export const ownedElsewhere = (owners, vehicleId, org) => { const k = owners?.get(vehicleId); return !!k && !k.has(placeKey(org)); };

// vin_matched_session exemplars. `orgs`: [{id, name, ids?:Set|array}] (ids = every id speaking for the place); `listingsByOrg`: Map(org id ->
// BaT history rows {url, vin}); `garageVins`: [{id, vin}]. Only sessions labelled dealer_lot / showroom (`labels`) count. Returns
// Map(org id -> [exemplar]), at most `perVehicle` per source vehicle; a vehicle matched to another place only is skipped.
export function vinMatchedExemplars(orgs, listingsByOrg, garageVins, sessions, labels = [], { exclude = [], perVehicle = 2, minVinLength = 9 } = {}) {
  const byVin = new Map();
  for (const g of garageVins ?? []) { const v = normVin(g?.vin); if (g?.id && v.length >= minVinLength && !isExcluded(g.id, exclude)) (byVin.get(v) ?? byVin.set(v, new Set()).get(v)).add(g.id); }
  const owners = vinOwners(orgs, listingsByOrg, garageVins, { minVinLength });
  const out = new Map();
  for (const o of orgs) {
    const found = new Map(); // vehicle id -> {vin, listing_url}
    for (const r of listingsByOrg.get(o.id) ?? []) for (const vid of byVin.get(normVin(r.vin)) ?? []) if (!found.has(vid) && !ownedElsewhere(owners, vid, o)) found.set(vid, { vin: normVin(r.vin), listing_url: r.url ?? null });
    const list = [];
    for (const [vid, f] of [...found].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
      const ok = new Set(labels.filter((l) => l.vehicle_id === vid && DEALER_LABELS.includes(l.scene_label)).map((l) => l.session_key));
      const picks = sessions.filter((s) => s.vehicle_id === vid && ok.has(s.session_key) && sampleUrl(s));
      const seen = new Set();
      for (const s of picks) {
        if (seen.size >= perVehicle) break;
        const url = sampleUrl(s); if (seen.has(s.session_key) || list.some((e) => e.url === url)) continue;
        seen.add(s.session_key);
        list.push({ url, source: 'vin_matched_session', cite: { vehicle_id: vid, session_key: s.session_key, vin: f.vin, listing_url: f.listing_url, source: 'vin_matched_session' } });
      }
    }
    if (list.length) out.set(o.id, list);
  }
  return out;
}

const labelKind = (l) => (DEALER_LABELS.includes(l) ? 'dealer' : SHOP_LABELS.includes(l) ? 'shop' : null);

// Scene-session exemplars: confident labels (>= minConf) whose session is at exactly one place. Returns Map(org_id -> [exemplar]).
export function sceneExemplars(sessions, labels, { minConf = 0.85, rep = null, exclude = [], owners = null } = {}) {
  const byKey = new Map(sessions.map((s) => [`${s.vehicle_id}|${s.session_key}`, s]));
  const out = new Map();
  for (const l of labels) {
    if (!(Number(l.confidence) >= minConf)) continue;
    const s = byKey.get(`${l.vehicle_id}|${l.session_key}`);
    const lk = labelKind(l.scene_label);
    if (!s || !lk) continue; // outdoor_street / other say nothing about a place
    const places = distinctOrgs(s.organizations, rep);
    let org = null;
    if (places.length === 1) org = places[0];
    else if (lk === 'shop') { const shops = places.filter((o) => orgKind(o.business_type) === 'shop'); if (shops.length === 1) org = shops[0]; }
    const url = sampleUrl(s);
    if (!org || isExcluded(s.vehicle_id, exclude) || !url || ownedElsewhere(owners, s.vehicle_id, org)) continue;
    const list = out.get(org.id) ?? []; if (list.some((e) => e.url === url || e.cite?.vehicle_id === s.vehicle_id)) continue; // one exemplar per vehicle
    list.push({ url, source: 'scene_session', cite: { vehicle_id: s.vehicle_id, session_key: s.session_key, scene_label: l.scene_label, confidence: Number(l.confidence), run_id: l.run_id ?? null, model: l.model ?? null } });
    out.set(org.id, list);
  }
  return out;
}

// Interleave BaT and scene exemplars up to max (BaT first), one list per organization.
export function mergeExemplars(bat, scene, max = 6) {
  const out = []; const a = [...bat]; const b = [...scene];
  while (out.length < max && (a.length || b.length)) { if (a.length) out.push(a.shift()); if (out.length < max && b.length) out.push(b.shift()); }
  return out;
}

// Fill `max` slots from the sources in `prefer` order (a source's exemplars are taken in their own order). bat_listing never precedes
// vin_matched_session. With no `prefer`: vin first, then BaT/scene interleaved.
export function mergeBySources({ bat = [], scene = [], vin = [] }, max = 6, prefer = null, minVin = 4) {
  if (vin.length && vin.length < minVin) return [...vin, ...bat].slice(0, max); // mixed fallback: bat_listing fills what vin leaves
  if (!vin.length) return prefer?.length ? fillInOrder({ bat_listing: bat, scene_session: scene }, prefer, max) : mergeExemplars(bat, scene, max);
  if (!prefer?.length) return [...vin.slice(0, max), ...mergeExemplars(bat, scene, Math.max(0, max - vin.length))];
  const order = prefer.filter((x) => x !== 'bat_listing' || prefer.indexOf('vin_matched_session') >= 0);
  const vi = order.indexOf('vin_matched_session'); const bi = order.indexOf('bat_listing');
  if (vi < 0) order.unshift('vin_matched_session'); else if (bi >= 0 && bi < vi) { order.splice(bi, 1); order.splice(order.indexOf('vin_matched_session') + 1, 0, 'bat_listing'); }
  return fillInOrder({ bat_listing: bat, scene_session: scene, vin_matched_session: vin }, order, max);
}
function fillInOrder(bySource, order, max) {
  const out = [];
  for (const k of [...order, ...Object.keys(bySource).filter((x) => !order.includes(x))]) for (const e of bySource[k] ?? []) if (out.length < max) out.push(e);
  return out;
}

export function buildExemplarRows(orgs, batByOrg, sceneByOrg, max = 6, { vinByOrg = new Map(), prefer = null, minVin = 4 } = {}) {
  return orgs.map((o) => ({ org_id: o.id, org_name: o.name ?? null, org_kind: orgKind(o.business_type),
    exemplars: mergeBySources({ bat: batByOrg.get(o.id) ?? [], scene: sceneByOrg.get(o.id) ?? [], vin: vinByOrg.get(o.id) ?? [] }, max, prefer, minVin) })).filter((r) => r.exemplars.length);
}

// ---- main ------------------------------------------------------------------------------------------------------------------

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const args = process.argv.slice(2);
  const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 && args[i + 1] !== undefined && !args[i + 1].startsWith('--') ? args[i + 1] : d; };
  const sessFile = opt('sessions-json');
  if (!sessFile) { console.error('usage: build-place-exemplars.mjs --sessions-json <file> [--history-jsonl f] [--aliases-json f | --from-aliases] [--labels-jsonl f] [--out f] [--cache-dir d] [--delay-ms 1000] [--max-per-org 6] [--garage-vins-json f] [--exclude-vehicles-json f] [--prefer-sources a,b,c] [--min-vin-exemplars 4]'); process.exit(2); }
  const out = opt('out', '/workspace/place_exemplars.json');
  const cacheDir = opt('cache-dir', '/workspace/bat-cache'); mkdirSync(cacheDir, { recursive: true });
  const delay = Number(opt('delay-ms', 1000)); const max = Number(opt('max-per-org', 6)); const perOrgListings = Number(opt('bat-listings-per-org', 4));
  const sessions = JSON.parse(readFileSync(sessFile, 'utf8'));
  const rep = representatives(sessions);
  const orgs = new Map();
  for (const s of sessions) for (const o of distinctOrgs(s.organizations, rep)) if (UUID.test(o.id) && !orgs.has(o.id)) orgs.set(o.id, o);
  // every id sharing a normalized name with a place speaks for it
  const idsByName = new Map();
  for (const s of sessions) for (const o of s.organizations ?? []) { if (!o?.id) continue; const k = normName(o.name) || o.id; (idsByName.get(k) ?? idsByName.set(k, new Set()).get(k)).add(o.id); }

  // (a) BaT listings of the organization
  let aliases = [];
  if (opt('aliases-json')) aliases = JSON.parse(readFileSync(opt('aliases-json'), 'utf8'));
  else if (args.includes('--from-aliases')) {
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY; if (!key) { console.error('--from-aliases needs SUPABASE_SERVICE_ROLE_KEY (run under dotenvx)'); process.exit(2); }
    const base = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? PROJECT_URL;
    const res = await fetch(`${base}/rest/v1/org_seller_aliases?select=organization_id,seller_username&platform=eq.bat`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) { console.error(`org_seller_aliases read failed: ${res.status}`); process.exit(2); }
    aliases = await res.json();
  }
  const handleOrgs = new Map(); // handle -> org ids
  for (const a of aliases) (handleOrgs.get(String(a.seller_username).toLowerCase()) ?? handleOrgs.set(String(a.seller_username).toLowerCase(), new Set()).get(String(a.seller_username).toLowerCase())).add(a.organization_id);
  const history = opt('history-jsonl') && existsSync(opt('history-jsonl')) ? readFileSync(opt('history-jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const listingsByOrg = new Map();
  for (const r of history) {
    const h = String(r.handle ?? r.seller_username ?? '').toLowerCase();
    for (const id of handleOrgs.get(h) ?? []) { const l = listingsByOrg.get(id) ?? []; if (r.url && !l.some((x) => x.url === r.url)) l.push(r); listingsByOrg.set(id, l); }
  }
  const batByOrg = new Map();
  for (const o of orgs.values()) {
    const ids = [...(idsByName.get(normName(o.name) || o.id) ?? [o.id])];
    const listings = ids.flatMap((id) => listingsByOrg.get(id) ?? []).slice(0, perOrgListings);
    const ex = [];
    for (const r of listings) {
      const slug = listingSlug(r.url); if (!slug) continue;
      const f = `${cacheDir}/listing-${slug}.html`; let html;
      try {
        if (existsSync(f)) html = readFileSync(f, 'utf8');
        else {
          await sleep(delay);
          const res = await fetch(r.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) });
          if (res.status === 403 || res.status === 429) { console.error(`HTTP ${res.status} from BaT; stopping the BaT fetches`); break; }
          if (!res.ok) { console.error(`  ${r.url}: HTTP ${res.status}`); continue; }
          html = await res.text(); writeFileSync(f, html);
        }
      } catch (e) { console.error(`  ${r.url}: ${e.message}`); continue; }
      for (const g of pickWide(parseGallery(html), ex.length ? 1 : 2)) ex.push({ url: g.url, source: 'bat_listing', cite: { listing_url: r.url, lot: r.lot_number ?? null, width: g.width, height: g.height } });
    }
    if (ex.length) batByOrg.set(o.id, ex);
  }

  // (b) scene sessions already at the organization
  const labelsFile = opt('labels-jsonl');
  const labels = labelsFile && existsSync(labelsFile) ? readFileSync(labelsFile, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const exclude = opt('exclude-vehicles-json') ? JSON.parse(readFileSync(opt('exclude-vehicles-json'), 'utf8')) : [];
    // (c) garage vehicles sold by the organization (VIN equals a history row's VIN)
  const garageVins = opt('garage-vins-json') ? JSON.parse(readFileSync(opt('garage-vins-json'), 'utf8')) : [];
  const orgListings = new Map(); const orgList = [];
  for (const o of orgs.values()) {
    const ids = idsByName.get(normName(o.name) || o.id) ?? new Set([o.id]);
    orgListings.set(o.id, [...ids].flatMap((id) => listingsByOrg.get(id) ?? [])); orgList.push({ id: o.id, name: o.name, ids });
  }
  const owners = vinOwners(orgList, orgListings, garageVins);
  const sceneByOrg = sceneExemplars(sessions, labels, { rep, exclude, owners });
  const minVin = Number(opt('min-vin-exemplars', 4));
  const vinByOrg = garageVins.length ? vinMatchedExemplars(orgList, orgListings, garageVins, sessions, labels, { exclude }) : new Map();
  const prefer = opt('prefer-sources') ? opt('prefer-sources').split(',').map((x) => x.trim()).filter(Boolean) : null;

  const rows = buildExemplarRows([...orgs.values()], batByOrg, sceneByOrg, max, { vinByOrg, prefer, minVin });
  writeFileSync(out, JSON.stringify(rows, null, 2));
  console.error(`${orgs.size} places in range of the sessions, ${rows.length} with exemplars (${rows.reduce((n, r) => n + r.exemplars.length, 0)} photos) -> ${out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
