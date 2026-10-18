// Extraction gold assay: grades what the database holds for each gold lot against the truth recorded by hand from
// the house's own page (scripts/assays/extraction-gold-v1.json). Read-only. The gold set is the yardstick every
// extractor is graded against; a pass here is fidelity to the source on these lots, not fleet accuracy.
//
//   cd ~/nuke && dotenvx run -q -- node scripts/assays/extraction-gold.mjs [--fixture path] [--json out.json] [--house bat]
//
// Verdicts per lot x field: pass (some model location holds the truth), wrong (the model holds a value, none correct),
// missing (nothing held, or the lot does not resolve to a vehicle), stale (a perishable lot past its end), and
// not graded when the source does not publish the field.
import { readFileSync, writeFileSync } from 'node:fs';

export const FIELDS = ['year', 'make', 'model', 'series', 'vin', 'mileage', 'exterior_color', 'interior_color', 'engine',
  'transmission', 'estimate_low', 'estimate_high', 'currency', 'outcome', 'hammer_price', 'price_with_premium', 'high_bid',
  'sale_date', 'auction_end', 'lot_number', 'gallery_count', 'seller', 'no_reserve', 'comment_count', 'bid_count'];
const MOVING = new Set(['outcome', 'high_bid', 'comment_count', 'bid_count', 'auction_end']);

export const norm = (s) => String(s ?? '').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/grey/g, 'gray').replace(/[^a-z0-9+]/g, '');
const num = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
const day = (v) => {
  if (!v) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? `${v}T12:00:00Z` : String(v));
  return Number.isFinite(t) ? t : null;
};

const OUTCOME = {
  sold: 'sold', sold_after: 'sold', sold_after_auction: 'sold',
  reserve_not_met: 'not_sold', unsold: 'not_sold', not_sold: 'not_sold', no_sale: 'not_sold', bid_to: 'not_sold',
  'bid-goes-on': 'not_sold', bid_goes_on: 'not_sold', passed: 'not_sold',
  live: 'live', active: 'live', auction_live: 'live',
  upcoming: 'upcoming', pending: 'upcoming', listed: 'upcoming', scheduled: 'upcoming',
};
export const normOutcome = (v) => (v == null || v === '' ? null : OUTCOME[String(v).toLowerCase()] ?? `unrecognized:${v}`);

/** Does one model value equal the truth for this field? */
export function matches(field, truth, value) {
  if (value === null || value === undefined || value === '') return null;
  const t = truth && typeof truth === 'object' && !Array.isArray(truth) ? truth : { value: truth };
  // A stored session window (the lot ran on one of these days, which the house does not say) is right when every day in
  // it is a day the truth allows.
  if (field === 'sale_date' && Array.isArray(value)) {
    if (!value.length) return null;
    const days = t.one_of ?? [t.value];
    return value.every((d) => days.some((x) => matches('sale_date', x, d)));
  }
  if (t.one_of) return t.one_of.some((v) => matches(field, v, value));
  const tv = t.value;
  switch (field) {
    case 'year': case 'gallery_count': case 'comment_count': case 'bid_count':
      return num(value) === num(tv);
    case 'estimate_low': case 'estimate_high': case 'hammer_price': case 'price_with_premium': case 'high_bid': {
      const a = num(value), b = num(tv);
      return a !== null && b !== null && Math.abs(a - b) <= Math.max(1, b * 0.005);
    }
    case 'mileage': {
      const a = num(value), b = num(tv);
      if (a === null || b === null) return false;
      const tol = t.approx ? Math.max(1000, b * 0.05) : 1;
      if (Math.abs(a - b) <= tol) return true;
      if (t.unit === 'km') return Math.abs(a - b * 0.621371) <= Math.max(tol, b * 0.02);
      return false;
    }
    case 'sale_date': {
      const a = day(value), b = day(tv);
      return a !== null && b !== null && Math.abs(a - b) <= 36 * 3600e3;
    }
    case 'auction_end': {
      const a = day(value), b = day(tv);
      return a !== null && b !== null && Math.abs(a - b) <= 5 * 60e3;
    }
    case 'vin': return norm(value).toUpperCase() === norm(tv).toUpperCase();
    case 'lot_number': return norm(value).replace(/^0+/, '') === norm(tv).replace(/^0+/, '');
    case 'outcome': return normOutcome(value) === tv;
    case 'no_reserve': return String(value).toLowerCase() === String(tv);
    case 'currency': return norm(value) === norm(tv);
    case 'make': case 'seller': return norm(value) === norm(tv);
    default: {
      const v = norm(value);
      if (t.match) return t.match.every((tok) => v.includes(norm(tok)));
      if (t.match_any) return t.match_any.some((tok) => v.includes(norm(tok)));
      return v === norm(tv) || v.startsWith(norm(tv));
    }
  }
}

/** Grade one field: candidates are [{ at, value }] in the order the model's readers prefer them. */
export function gradeField(field, truth, candidates) {
  const held = candidates.filter((c) => c.value !== null && c.value !== undefined && c.value !== '');
  if (!held.length) return { verdict: 'missing' };
  const hit = held.find((c) => matches(field, truth, c.value));
  const disagree = held.filter((c) => !matches(field, truth, c.value));
  if (hit) return { verdict: 'pass', at: hit.at, ...(disagree.length ? { also_held: disagree.map((c) => ({ at: c.at, value: c.value })) } : {}) };
  if (field === 'price_with_premium') {
    // A held figure 4-30% under the premium-inclusive price is the hammer: the premium-inclusive figure is absent.
    const t = num(truth?.value ?? truth), h = num(held[0].value);
    if (t && h && t / h >= 1.04 && t / h <= 1.3) return { verdict: 'missing', reason: 'held_hammer_only', at: held[0].at, value: held[0].value };
  }
  return { verdict: 'wrong', at: held[0].at, value: held[0].value, ...(held.length > 1 ? { also_held: held.slice(1).map((c) => ({ at: c.at, value: c.value })) } : {}) };
}

/** The model's candidate values for every field, from one lot's database read. */
export function candidates(m) {
  const v = m?.v ?? {}, ve = m?.ve ?? {}, ae = m?.ae ?? {}, md = ve.metadata ?? {}, raw = ae.raw_data ?? {};
  const c = (pairs) => pairs.map(([at, value]) => ({ at, value }));
  const joined = (...xs) => xs.filter((x) => x != null && x !== '').join(' ') || null;
  return {
    year: c([['vehicles.year', v.year]]),
    make: c([['vehicles.make', v.make]]),
    model: c([['vehicles.model', v.model]]),
    series: c([['vehicles.series', v.series], ['vehicles.trim', v.trim], ['vehicles.trim_level', v.trim_level], ['vehicles.model', v.model]]),
    vin: c([['vehicles.vin', v.vin]]),
    mileage: c([['vehicles.mileage', v.mileage]]),
    exterior_color: c([['vehicles.color', v.color], ['vehicles.color_primary', v.color_primary]]),
    interior_color: c([['vehicles.interior_color', v.interior_color]]),
    engine: c([['vehicles.engine_*', joined(v.engine_type, v.engine_size, v.engine_code, v.engine_displacement, v.engine_liters)]]),
    transmission: c([['vehicles.transmission*', joined(v.transmission, v.transmission_type, v.transmission_speeds)]]),
    estimate_low: c([['auction_events.estimate_low', ae.estimate_low], ['vehicle_events.metadata.estimate_low', md.estimate_low ?? md.low_estimate]]),
    estimate_high: c([['auction_events.estimate_high', ae.estimate_high], ['vehicle_events.metadata.estimate_high', md.estimate_high ?? md.high_estimate]]),
    currency: c([['vehicle_events.metadata.currency', md.currency ?? md.currency_code], ['auction_events.raw_data.currency', raw.currency],
      ['monitored_auctions.stream_state.currency', m?.ma?.stream_state?.currency], ['vehicles.origin_metadata.currency', v.origin_metadata?.currency]]),
    outcome: c([['vehicle_events.event_status', ve.event_status], ['auction_events.outcome', ae.outcome], ['vehicles.auction_outcome', v.auction_outcome], ['vehicles.sale_status', v.sale_status]]),
    hammer_price: c([['vehicle_events.final_price', ve.final_price], ['auction_events.winning_bid', ae.winning_bid], ['vehicles.sale_price', v.sale_price], ['vehicles.sold_price', v.sold_price], ['vehicles.bat_sold_price', v.bat_sold_price]]),
    price_with_premium: c([['vehicle_events.final_price', ve.final_price], ['auction_events.winning_bid', ae.winning_bid], ['vehicles.sale_price', v.sale_price], ['vehicles.sold_price', v.sold_price]]),
    high_bid: c([['auction_events.high_bid', ae.high_bid], ['vehicle_events.current_price', ve.current_price], ['vehicle_events.final_price', ve.final_price], ['vehicles.high_bid', v.high_bid], ['monitored_auctions.current_bid', m?.ma?.current_bid_cents != null ? m.ma.current_bid_cents / 100 : null]]),
    sale_date: c([['vehicle_events.sold_at', ve.sold_at], ['vehicle_events.ended_at', ve.ended_at], ['auction_events.auction_end_date', ae.auction_end_date], ['vehicles.sale_date', v.sale_date], ['vehicles.auction_end_date', v.auction_end_date],
      ['vehicle_events.metadata.auction_session_days', Array.isArray(md.auction_session_days) && md.auction_session_days.length ? md.auction_session_days : null]]),
    auction_end: c([['monitored_auctions.auction_end_time', m?.ma?.auction_end_time], ['auction_events.auction_end_date', ae.auction_end_date], ['vehicle_events.ended_at', ve.ended_at], ['vehicles.auction_end_date', v.auction_end_date]]),
    lot_number: c([['auction_events.lot_number', ae.lot_number], ['vehicle_events.metadata.lot_number', md.lot_number], ['vehicles.bat_lot_number', v.bat_lot_number]]),
    gallery_count: c([['vehicle_images(count)', m?.images], ['vehicles.image_count', v.image_count]]),
    seller: c([['vehicle_events.seller_identifier', ve.seller_identifier], ['auction_events.seller_name', ae.seller_name], ['vehicles.bat_seller', v.bat_seller], ['vehicles.seller_name', v.seller_name]]),
    no_reserve: c([['vehicle_events.metadata.no_reserve', md.no_reserve], ['auction_events.raw_data.no_reserve', raw.no_reserve]]),
    comment_count: c([['auction_comments(non-bid)', m?.comments?.non_bid || null], ['auction_events.comments_count', ae.comments_count], ['vehicle_events.comment_count', ve.comment_count]]),
    bid_count: c([['auction_comments(bid)', m?.comments?.bid || null], ['auction_events.total_bids', ae.total_bids], ['vehicle_events.bid_count', ve.bid_count], ['vehicles.bid_count', v.bid_count],
      ['monitored_auctions.bid_count', m?.ma?.bid_count], ['vehicles.origin_metadata.bid_count', v.origin_metadata?.bid_count]]),
  };
}

/** Grade one gold lot against its database read (null when the lot did not resolve). */
export function gradeLot(lot, model, now = Date.now()) {
  const ended = lot.perishable && day(lot.truth.auction_end) !== null && now > day(lot.truth.auction_end);
  const cand = model ? candidates(model) : null;
  const fields = {};
  for (const f of FIELDS) {
    if (!(f in lot.truth) || lot.truth[f] === null) continue;
    if (ended && MOVING.has(f)) { fields[f] = { verdict: 'stale' }; continue; }
    fields[f] = cand ? gradeField(f, lot.truth[f], cand[f]) : { verdict: 'missing', reason: 'lot_not_resolved' };
  }
  return { key: lot.key, house: lot.house, stage: lot.stage, vehicle_id: model?.vehicle_id ?? null, resolved: !!model, fields };
}

/** Per-house, per-field tallies. */
export function scorecard(results) {
  const houses = {};
  for (const r of results) {
    const h = houses[r.house] ??= { lots: 0, resolved: 0, fields: {}, totals: { pass: 0, wrong: 0, missing: 0, stale: 0 } };
    h.lots++; if (r.resolved) h.resolved++;
    for (const [f, g] of Object.entries(r.fields)) {
      const t = h.fields[f] ??= { pass: 0, wrong: 0, missing: 0, stale: 0 };
      t[g.verdict]++; h.totals[g.verdict]++;
    }
  }
  return houses;
}

// ---- database read (Management API, read-only) ----
function urlVariants(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/\/$/, '');
  const host = u.host.replace(/^www\./, '');
  const out = new Set();
  for (const sch of ['https://', 'http://']) for (const h of [host, `www.${host}`]) for (const t of ['', '/']) out.add(`${sch}${h}${path}${t}`);
  return [...out];
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;

export function lotSql(lot) {
  const urls = `ARRAY[${urlVariants(lot.url).map(lit).join(',')}]::text[]`;
  return `
with ve as (select * from vehicle_events where source_url = any(${urls}) and vehicle_id is not null
            order by (source_platform = ${lit(lot.platform)}) desc, updated_at desc nulls last limit 1),
vid as (select coalesce((select vehicle_id from ve),
          (select id from vehicles where listing_url = any(${urls}) and deleted_at is null limit 1)) as id),
ae as (select * from auction_events where vehicle_id = (select id from vid)
        order by (source_url = any(${urls})) desc, updated_at desc nulls last limit 1),
ma as (select current_bid_cents, auction_end_time, last_synced_at, bid_count, stream_state from monitored_auctions
        where vehicle_id = (select id from vid) order by last_synced_at desc nulls last limit 1)
select (select id from vid) as vehicle_id,
  (select to_jsonb(v) - 'description' - 'search_vector' from vehicles v where v.id = (select id from vid)) as v,
  (select to_jsonb(ve) from ve) as ve,
  (select to_jsonb(ae) - 'bid_history' - 'receipt_data' - 'ai_summary' - 'sentiment_arc' - 'key_moments' - 'top_contributors' - 'forensics_data' from ae) as ae,
  (select to_jsonb(ma) from ma) as ma,
  (select count(*) from vehicle_images i where i.vehicle_id = (select id from vid) and coalesce(i.is_superseded, false) = false) as images,
  coalesce(
    (select jsonb_build_object('bid', count(*) filter (where c.comment_type = 'bid'), 'non_bid', count(*) filter (where c.comment_type is distinct from 'bid'), 'keyed_to', 'auction_event')
       from auction_comments c where c.auction_event_id = (select id from ae) having count(*) > 0),
    (select jsonb_build_object('bid', count(*) filter (where c.comment_type = 'bid'), 'non_bid', count(*) filter (where c.comment_type is distinct from 'bid'), 'keyed_to', 'vehicle')
       from auction_comments c where c.vehicle_id = (select id from vid))) as comments`;
}

async function query(sql) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) throw new Error('SUPABASE_ACCESS_TOKEN not set (run under dotenvx)');
  const r = await fetch('https://api.supabase.com/v1/projects/qkgaybvrernstplzjaam/database/query', {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: `set statement_timeout = '20s'; ${sql}`, read_only: true }),
  });
  const j = await r.json();
  if (!Array.isArray(j)) throw new Error(JSON.stringify(j).slice(0, 300));
  return j;
}

const SYM = { pass: 'P', wrong: 'W', missing: '-', stale: 's' };
function printReport(fixture, results, houses) {
  console.log(`extraction gold assay — ${fixture.version}, ${results.length} lots, read ${new Date().toISOString()}`);
  console.log('P pass, W wrong value held, - missing, s stale (perishable lot past its end); blank = source does not publish\n');
  const used = FIELDS.filter((f) => results.some((r) => r.fields[f]));
  const abbr = (f) => f.replace('price_with_premium', 'prem').replace('hammer_price', 'hammer').replace('exterior_color', 'ext').replace('interior_color', 'int')
    .replace('estimate_', 'est_').replace('gallery_count', 'gallery').replace('comment_count', 'cmts').replace('bid_count', 'bids').replace('transmission', 'trans').replace('auction_end', 'end').replace('lot_number', 'lot').replace('no_reserve', 'nores').replace('sale_date', 'date');
  console.log('lot'.padEnd(30) + used.map((f) => abbr(f).padStart(Math.max(4, abbr(f).length + 1))).join(''));
  for (const r of results) {
    console.log((r.resolved ? r.key : `${r.key}*`).padEnd(30) + used.map((f) => (r.fields[f] ? SYM[r.fields[f].verdict] : '').padStart(Math.max(4, abbr(f).length + 1))).join(''));
  }
  console.log('* lot does not resolve to a vehicle in the database\n');
  console.log('house'.padEnd(18) + 'lots  resolved  graded  pass  wrong  missing  pass%');
  for (const [h, s] of Object.entries(houses)) {
    const graded = s.totals.pass + s.totals.wrong + s.totals.missing;
    console.log(h.padEnd(18) + String(s.lots).padStart(4) + String(s.resolved).padStart(10) + String(graded).padStart(8) + String(s.totals.pass).padStart(6)
      + String(s.totals.wrong).padStart(7) + String(s.totals.missing).padStart(9) + `${graded ? Math.round((100 * s.totals.pass) / graded) : 0}%`.padStart(7));
  }
  console.log('\nwrong values (model location: held → truth):');
  for (const r of results) for (const [f, g] of Object.entries(r.fields)) {
    if (g.verdict !== 'wrong' && !g.reason?.startsWith('held_')) continue;
    const lot = fixture.lots.find((l) => l.key === r.key);
    const t = lot.truth[f];
    console.log(`  ${r.key} ${f}: ${g.at}=${JSON.stringify(g.value)} → ${JSON.stringify(t?.value ?? t?.one_of ?? t)}${g.reason ? ` (${g.reason})` : ''}`);
  }
}

async function main() {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const fixture = JSON.parse(readFileSync(arg('--fixture') ?? new URL('./extraction-gold-v1.json', import.meta.url), 'utf8'));
  const only = arg('--house');
  const results = [];
  for (const lot of fixture.lots.filter((l) => !only || l.house === only)) {
    const [row] = await query(lotSql(lot));
    results.push(gradeLot(lot, row?.vehicle_id ? row : null));
  }
  const houses = scorecard(results);
  printReport(fixture, results, houses);
  if (arg('--json')) writeFileSync(arg('--json'), JSON.stringify({ version: fixture.version, read_at: new Date().toISOString(), houses, results }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(2); });
