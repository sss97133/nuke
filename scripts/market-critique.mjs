#!/usr/bin/env node
/**
 * The market editor, nightly: builds the market page's model from the live readers and prints every violation of
 * the owner's rules (nuke_frontend/src/pages/market/critique.ts) with its numbers. Exits 1 when any rule is broken,
 * 2 when a reader could not be read. Read-only: the anon key and the public readers the page itself calls.
 *
 *   node scripts/market-critique.mjs                              # the brands level, all makes
 *   node scripts/market-critique.mjs --scope 'make=Lexus&family_name=LC'
 *
 * Run by scripts/night-run/run.sh before the night agent, report under ~/nuke-logs/market-critique/<date>.txt.
 */
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const front = resolve(here, '..', 'nuke_frontend');
// The rules and the map's scale are TypeScript; load them through tsx (nuke_frontend's dev dependency).
const req = createRequire(resolve(front, 'package.json'));
const { register } = await import(req.resolve('tsx/esm/api'));
register();
const mapScale = await import(resolve(front, 'src/pages/market/mapScale.ts'));
const { critique, report } = await import(resolve(front, 'src/pages/market/critique.ts'));
const { matchesFamilyScope } = await import(resolve(front, 'src/pages/market/scopeMatch.ts'));

const url = (process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || 'https://qkgaybvrernstplzjaam.supabase.co').replace(/\/$/, '');
const key = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
if (!key) { console.error('market-critique: no anon key (VITE_SUPABASE_ANON_KEY); run under dotenvx'); process.exit(2); }
const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

const args = process.argv.slice(2);
const scopeArg = args.includes('--scope') ? args[args.indexOf('--scope') + 1] : '';
const scope = Object.fromEntries(new URLSearchParams(scopeArg));
const make = scope.make?.trim() || null;
const familyName = scope.family_name?.trim() || null;
const model = scope.model?.trim() || null;

async function rpc(name, body = {}) {
  const r = await fetch(`${url}/rest/v1/rpc/${name}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`${name}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
// PostgREST answers at most 1,000 rows per request: page by Range until a page comes back short (at most 20 pages).
async function rest(path, pageSize = 1000) {
  const out = [];
  for (let page = 0; page < 20; page++) {
    const from = page * pageSize;
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: { ...headers, Range: `${from}-${from + pageSize - 1}`, 'Range-Unit': 'items' } });
    if (!r.ok && r.status !== 206) throw new Error(`${path.split('?')[0]}: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) return rows;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

try {
  const [refreshRows, brands, market, pulse] = await Promise.all([
    rest('treemap_refreshes?select=refreshed_at,populations&order=refreshed_at.desc&limit=1'),
    rpc('treemap_by_brand'), rpc('treemap_brand_market'), rpc('market_pulse_live'),
  ]);
  const refresh = refreshRows[0] ?? {};
  const pop = refresh.populations ?? {};
  const houses = mapScale.measuredHouses(pop.measured_houses);

  // The brand map as HomePage.readTreemapBrands joins it.
  const byName = new Map(market.map((m) => [m.name, m]));
  const nodes = brands.map((n) => ({ ...n, ...(byName.get(n.name) ?? {}) }));
  const base = mapScale.batBaseline(nodes);
  const tiles = nodes.map((n) => ({ name: n.name, usd: Number(n.usd ?? 0), move: mapScale.relativeMove(n, base, true, mapScale.GATE_MIN, houses) }));
  const items = mapScale.callouts(nodes, base, mapScale.GATE_MIN);
  const levelDollars = nodes.reduce((s, n) => s + Math.max(0, Number(n.usd_12m ?? 0)), 0);
  const dollarsOf = Object.fromEntries(nodes.map((n) => [n.name, Number(n.usd_12m ?? 0)]));
  const fmt = (n) => Number(n).toLocaleString('en-US');

  // The Sources board's label for the scope (SourcesBoard: a family scopes it through treemap_family_sales; a make
  // alone has no per-house reader and keeps the all-makes board).
  let sourcesBoard = { label: 'Sources' };
  if (make && familyName) {
    const families = await rpc('treemap_brand_families', { p_brand: make });
    const fam = (Array.isArray(families) ? families : []).find((f) => (f.family ?? f.name ?? '').toLowerCase() === familyName.toLowerCase());
    const key = fam?.family_key ?? fam?.familyKey ?? null;
    const sales = key ? await rpc('treemap_family_sales', { p_brand: make, p_family_key: key, p_limit: 15000 }) : null;
    const n = Array.isArray(sales) ? sales.length : Number(sales?.n ?? (Array.isArray(sales?.rows) ? sales.rows.length : 0));
    sourcesBoard = { label: n > 0 ? `Sources · ${[make, familyName, model].filter(Boolean).join(' ')}` : 'Sources · all makes' };
  } else if (make) {
    sourcesBoard = { label: 'Sources · all makes' };
  }

  // The live board (market_pulse_live, Bring a Trailer) against the Feed's open lots at every source, same scope.
  const inScope = (lot) => (!make || (lot.make ?? '').toUpperCase() === make.toUpperCase())
    && (model != null || matchesFamilyScope(lot, familyName))
    && (!model || (lot.model ?? '').toLowerCase().startsWith(model.toLowerCase()));
  const boardLots = (pulse?.auctions ?? []).map((r) => ({ make: r[2], model: r[3], title: r[11] })).filter(inScope);
  const now = new Date().toISOString();
  const q = `vehicles?select=make,model,title,platform_source&sale_status=eq.auction_live&is_public=is.true&deleted_at=is.null&auction_end_date=gt.${encodeURIComponent(now)}${make ? `&make=ilike.${encodeURIComponent(make)}` : ''}`;
  const feedLots = (await rest(q)).filter(inScope);
  const feedBySource = {};
  for (const l of feedLots) feedBySource[l.platform_source ?? 'unknown'] = (feedBySource[l.platform_source ?? 'unknown'] ?? 0) + 1;
  const liveLabel = `Bring a Trailer${make ? ` · ${make.toUpperCase()}${familyName ? ` · ${familyName}` : ''}` : ''}`;

  const page = {
    scope: { make, family: familyName, model },
    statements: [{ fact: 'share:by-house', where: 'sources-board' }],
    headlines: [
      { text: `${fmt(pop.mapped_sales ?? 0)} vehicles with a confirmed sale of ${fmt(pop.public_records ?? 0)} public records`, window: 'all time', where: 'map-caption' },
      ...items.map((c) => ({ text: `${c.kind} ${c.name} ${mapScale.pct(c.rel)} (${c.prior} → ${c.sold})`, window: 'last 12 months against the 12 before', where: 'callouts' })),
    ],
    callouts: { items, levelDollars, dollarsOf, gateMin: mapScale.GATE_MIN },
    tiles,
    sourcesBoard,
    liveBoard: { label: liveLabel, count: boardLots.length, feedOpenLots: feedLots.length, feedBySource },
  };

  const violations = critique(page);
  console.log(`market critique · ${new Date().toISOString()} · refresh ${refresh.refreshed_at ?? 'unknown'} · measured houses: ${houses.join(', ')} · scope: ${make ? [make, familyName, model].filter(Boolean).join(' ') : 'all makes'}`);
  for (const line of report(violations)) console.log(line);
  const unmeasured = tiles.filter((t) => t.move.kind === 'few' && t.move.why === 'share').map((t) => { const n = byName.get(t.name) ?? {}; return `${t.name} ${fmt(n.dated ?? 0)} of ${fmt(n.sold ?? 0)} sales at the measured houses`; });
  const gated = tiles.filter((t) => t.move.kind !== 'none').length;
  console.log(`notes: ${tiles.length} brands, ${tiles.filter((t) => t.move.kind === 'move').length} colored, ${gated - tiles.filter((t) => t.move.kind === 'move').length} too few; unmeasured houses: ${unmeasured.length ? unmeasured.join('; ') : 'none'}`);
  console.log(`notes: live board ${boardLots.length} open lots (Bring a Trailer); Feed ${feedLots.length} across ${Object.entries(feedBySource).map(([k, v]) => `${k} ${v}`).join(', ') || 'no source'}`);
  process.exit(violations.length ? 1 : 0);
} catch (e) {
  console.error(`market-critique: ${e.message}`);
  process.exit(2);
}
