#!/usr/bin/env node
// Reads a Bring a Trailer seller's whole listing history (member page + its "Show more" ajax pages + each listing's
// detail page) and writes it as JSONL, plus a read-only VALUES-CTE SQL file the relationship preview can read in place of
// listing_detail_enrichments and a matcher query. Nothing is written to a database unless --apply is given.
//
//   node scripts/garage/ingest-bat-seller-history.mjs <handle> [<handle> ...] --out /workspace/h.jsonl --values-sql /workspace/h_values.sql
//   dotenvx run -- node scripts/garage/ingest-bat-seller-history.mjs --from-aliases --out ...   (handles of org_seller_aliases, platform bat)
//   ... --apply     upsert into bat_listings by bat_listing_url, additive (existing rows are left as they are), raw_data.run_id
//   ... --parse-only <html file>   print what the parser reads from a saved member or listing page
//
// Flow per handle: GET /member/<handle>/ ; data-user-id of the "Show more" button ; page 1 listings from that HTML ;
// POST /wp-admin/admin-ajax.php action=bat_profile_more_items&itemType=listings_past&itemPaged=N&userID=<id> (case-sensitive; userId is ignored and returns site-wide listings) until itemMore is
// false ; then every listing URL's detail page (lot, VIN / chassis, seller, title, end date, sale price / status).
// Polite: one request per second (--delay-ms), retries with back-off, stops on 403 / 429, raw responses cached under
// --cache-dir (default /workspace/bat-cache) so a rerun does not fetch again. Default mode is a dry run.
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseBatListing } from './enrich-bat-listing.mjs';

const UA = 'Mozilla/5.0';
const BASE = 'https://bringatrailer.com';
const PROJECT_URL = 'https://qkgaybvrernstplzjaam.supabase.co';
export const PRODUCER = 'ingest-bat-seller-history/1';

const decode = (s) => s.replace(/&#0?38;|&#038;|&amp;/g, '&').replace(/&#0?39;|&#8217;|&apos;/g, "'").replace(/&quot;|&#8220;|&#8221;/g, '"')
  .replace(/&#215;/g, '×').replace(/&nbsp;/g, ' ');
const strip = (h) => decode(h.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
const isoDate = (unixSeconds) => (Number.isFinite(+unixSeconds) && +unixSeconds > 0 ? new Date(+unixSeconds * 1000).toISOString().slice(0, 10) : null);
export const listingSlug = (u) => (String(u).match(/\/listing\/([a-z0-9-]+)\/?/i) || [])[1] ?? null;
export const handleOk = (h) => /^[A-Za-z0-9_.-]{2,60}$/.test(h);

// "Bid to USD $29,500 on 8/4/2026" / "Sold for USD $35,000 on 8/4/2026" -> {status, price}
export function parseResultText(text) {
  const t = strip(text ?? '');
  const price = (t.match(/\$\s*([\d,]+)/) || [])[1];
  const n = price ? Number(price.replace(/,/g, '')) : null;
  if (/^sold\b/i.test(t) || /\bsold for\b/i.test(t)) return { status: 'sold', price: n };
  if (/\bbid to\b/i.test(t)) return { status: 'no_sale', price: n };
  if (/withdrawn/i.test(t)) return { status: 'cancelled', price: null };
  return { status: t ? 'ended' : null, price: n };
}

// listing cards (member page 1 and ajax pages): [{url, title, end_date, result}]
export function parseCards(html) {
  const out = []; const seen = new Set();
  for (const part of html.split(/<div[^>]*class="listing-card\b/).slice(1)) {
    const url = (part.match(/<h3>\s*<a[^>]*href="(https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+\/?)"/i)
      || part.match(/href="(https:\/\/bringatrailer\.com\/listing\/[a-z0-9-]+\/?)"/i) || [])[1];
    if (!url || seen.has(url)) continue; seen.add(url);
    const title = (part.match(/<h3>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || [])[1];
    const end = (part.match(/data-timestamp_end="(\d+)"/) || [])[1];
    const res = (part.match(/class="item-results">([\s\S]*?)<\/div>/i) || [])[1];
    out.push({ url, title: title ? strip(title) : null, end_date: isoDate(end), result: res ? parseResultText(res) : null });
  }
  return out;
}

// member page: the numeric user id and the next listings_past page from the "Show more" button
export function parseMemberHtml(html) {
  const btn = html.match(/<button[^>]*data-item-type="listings_past"[^>]*>/i);
  const attr = (n) => (btn?.[0].match(new RegExp(`${n}="(\\d+)"`)) || [])[1];
  const userId = attr('data-user-id') ?? (html.match(/data-user-id="(\d+)"/) || [])[1] ?? null;
  return { userId, nextPage: attr('data-item-paged') ? Number(attr('data-item-paged')) : null, cards: parseCards(html) };
}

export function parseAjax(text) {
  const j = JSON.parse(text);
  return { more: j.itemMore === true, nextPage: Number(j.itemPaged) || null, cards: parseCards(j.output ?? '') };
}

// listing detail page -> lot, VIN / chassis, seller, title, end date, result
export function parseDetail(html) {
  const p = parseBatListing(html);
  const info = (html.match(/class="listing-available-info"[\s\S]*?<\/div>/i) || [])[0] ?? '';
  const end = (info.match(/data-timestamp="(\d+)"/) || html.match(/class="date date-localize" data-timestamp="(\d+)"/) || [])[1];
  const lotTitle = (html.match(/<title>[^<]*\(Lot\s*#\s*([\d,]+)\)/i) || [])[1];
  // Fallbacks for the listing-essentials block: '<strong>Lot</strong> #255909' and the Seller member link.
  const lotItem = (html.match(/<strong>Lot<\/strong>\s*#\s*([\d,]+)/i) || [])[1];
  const sellerItem = (html.match(/item-seller"><strong>Seller<\/strong>:\s*<a href="https:\/\/bringatrailer\.com\/member\/([^/"]+)\/?"/i) || [])[1];
  return {
    title: p.title, lot_number: p.lot_number ?? ((lotTitle ?? lotItem) ? (lotTitle ?? lotItem).replace(/,/g, '') : null),
    vin: p.chassis, seller_username: p.seller_username ?? (sellerItem ? decodeURIComponent(sellerItem).toLowerCase() : null), end_date: isoDate(end), result: info ? parseResultText(info) : null,
  };
}

const sqlText = (v) => (v == null || v === '' ? 'NULL::text' : `'${String(v).replace(/'/g, "''")}'::text`);
const sqlDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v ?? '') ? `DATE '${v}'` : 'NULL::date');

// The read-only SQL file: hist_listings (the placeholder CTE of derive_vehicle_relationships_preview.sql, same columns) and
// a standalone matcher. Exact VIN first; otherwise year + model family + the seller's organization + a photo date window,
// reported as match_basis = 'seller_year_model_window', confidence = 'low' (a proposal, never a decision).
export function buildValuesSql(rows, { source = 'ingest-bat-seller-history' } = {}) {
  const vals = rows.map((r) => `  (${sqlText(r.url)}, ${sqlText(r.lot_number)}, ${sqlText(r.vin)}, ${sqlText(r.seller_username)}, ${sqlText(r.title)}, ${sqlDate(r.end_date)})`);
  const values = vals.length ? vals.join(',\n') : '  (NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::date)';
  return `-- READ-ONLY. Generated by scripts/garage/${source}.mjs from public bringatrailer.com pages; ${rows.length} listings.
-- 1) Paste the hist_listings CTE below over the empty hist_listings placeholder of supabase/sql/derive_vehicle_relationships_preview.sql
--    (columns url, lot, vin, seller, title, end_date; keep the name), or
-- 2) run this file as is: it matches the listings to the vehicles of one account and writes nothing.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -v user_id=<uuid> -f <this file>   (read-only session)
WITH hist_listings(url, lot, vin, seller, title, end_date) AS (
  VALUES
${values}
),
hv AS (
  SELECT h.*, (regexp_match(coalesce(h.title, ''), '\\m(19[0-9]{2}|20[0-4][0-9])\\M'))[1]::int AS ty,
         btrim(regexp_replace(lower(coalesce(h.title, '')), '[^a-z0-9]+', ' ', 'g')) AS tl,
         upper(regexp_replace(coalesce(h.vin, ''), '[^A-Za-z0-9]', '', 'g')) AS vin_n
    FROM hist_listings h WHERE h.url IS NOT NULL
),
acct AS (
  SELECT v.id, v.year, v.make, v.model, normalize_vehicle_model_family(v.model) AS fam,
         upper(regexp_replace(coalesce(v.vin, ''), '[^A-Za-z0-9]', '', 'g')) AS vin_n
    FROM vehicles v WHERE v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
     AND (v.user_id = :'user_id'::uuid OR EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = v.id AND vi.user_id = :'user_id'::uuid))
),
exact AS (
  SELECT hv.url, a.id AS vehicle_id, 'exact_vin'::text AS match_basis, 'high'::text AS confidence, NULL::date AS photo_window_hit
    FROM hv JOIN acct a ON length(hv.vin_n) >= 9 AND a.vin_n = hv.vin_n
),
fuzzy AS (
  SELECT DISTINCT ON (hv.url, a.id) hv.url, a.id AS vehicle_id, 'seller_year_model_window'::text AS match_basis, 'low'::text AS confidence,
         (SELECT min(coalesce(vi.taken_at, vi.created_at))::date FROM vehicle_images vi
           WHERE vi.vehicle_id = a.id AND coalesce(vi.taken_at, vi.created_at)
                 BETWEEN hv.end_date::timestamptz - interval '365 days' AND hv.end_date::timestamptz + interval '90 days') AS photo_window_hit
    FROM hv
    JOIN org_seller_aliases sa ON sa.platform = 'bat' AND sa.seller_username = hv.seller
    JOIN acct a ON hv.ty = a.year AND a.fam IS NOT NULL
     AND strpos(' ' || hv.tl || ' ', ' ' || btrim(regexp_replace(a.fam, '[^a-z0-9]+', ' ', 'g')) || ' ') > 0
    WHERE hv.end_date IS NOT NULL
      AND EXISTS (SELECT 1 FROM organization_vehicles ov WHERE ov.vehicle_id = a.id AND ov.organization_id = sa.organization_id)
      AND EXISTS (SELECT 1 FROM vehicle_images vi WHERE vi.vehicle_id = a.id
                   AND coalesce(vi.taken_at, vi.created_at) BETWEEN hv.end_date::timestamptz - interval '365 days' AND hv.end_date::timestamptz + interval '90 days')
      AND NOT EXISTS (SELECT 1 FROM exact e WHERE e.url = hv.url)
)
SELECT m.url, m.vehicle_id, m.match_basis, m.confidence, m.photo_window_hit, hv.title, hv.lot, hv.vin, hv.seller, hv.end_date
  FROM (SELECT * FROM exact UNION ALL SELECT * FROM fuzzy) m JOIN hv ON hv.url = m.url
 ORDER BY m.confidence, hv.end_date DESC NULLS LAST, m.url;
`;
}

// bat_listings insert row (additive: an existing bat_listing_url is left untouched)
export function toBatListingRow(r, runId) {
  const sold = r.result?.status === 'sold';
  return {
    bat_listing_url: r.url, bat_lot_number: r.lot_number ?? null, bat_listing_title: r.title ?? null,
    auction_end_date: r.end_date ?? null, sale_date: sold ? r.end_date ?? null : null, sale_price: sold ? r.result.price ?? null : null,
    final_bid: r.result?.price ?? null, seller_username: r.seller_username ?? null,
    listing_status: ['sold', 'no_sale', 'cancelled'].includes(r.result?.status) ? r.result.status : 'ended',
    raw_data: { run_id: runId, producer: PRODUCER, vin: r.vin ?? null, member_handle: r.handle, source: 'bat_member_history' },
  };
}

// ---------------------------------------------------------------- network (only when run as a script)
const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const po = args.indexOf('--parse-only');
  if (po >= 0) {
    const html = readFileSync(args[po + 1], 'utf8');
    console.log(JSON.stringify({ member: parseMemberHtml(html), detail: parseDetail(html) }, null, 2));
    return;
  }
  const delay = Number(opt('delay-ms', 1000)); const cacheDir = opt('cache-dir', '/workspace/bat-cache');
  const out = opt('out', '/workspace/bat_history.jsonl'); const valuesOut = opt('values-sql', null);
  const limit = Number(opt('limit', 0)); const apply = args.includes('--apply'); const runId = randomUUID();
  mkdirSync(cacheDir, { recursive: true });
  let handles = args.filter((a, i) => !a.startsWith('--') && !['--out', '--values-sql', '--cache-dir', '--delay-ms', '--limit'].includes(args[i - 1]));
  if (args.includes('--from-aliases')) {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? PROJECT_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) { console.error('--from-aliases needs SUPABASE_SERVICE_ROLE_KEY (run under dotenvx)'); process.exit(2); }
    const res = await fetch(`${url}/rest/v1/org_seller_aliases?select=seller_username&platform=eq.bat`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
    if (!res.ok) { console.error(`org_seller_aliases read failed: ${res.status}`); process.exit(2); }
    handles = [...new Set([...handles, ...(await res.json()).map((r) => r.seller_username)])];
  }
  handles = handles.filter(Boolean);
  if (!handles.length || handles.some((h) => !handleOk(h))) { console.error('give valid BaT seller handles or --from-aliases'); process.exit(2); }

  // cached, polite, retried fetch; text body or throws
  const get = async (name, doFetch) => {
    const f = `${cacheDir}/${name}`;
    if (existsSync(f)) return readFileSync(f, 'utf8');
    let last;
    for (let a = 1; a <= 3; a++) {
      await sleep(delay);
      try {
        const res = await doFetch();
        if (res.status === 403 || res.status === 429) throw Object.assign(new Error(`HTTP ${res.status}`), { fatal: true });
        if (res.ok) { const t = await res.text(); writeFileSync(f, t); return t; }
        last = new Error(`HTTP ${res.status}`);
      } catch (e) { if (e.fatal) throw e; last = e; }
      await sleep(delay * 2 ** a);
    }
    throw last;
  };
  const rows = [];
  for (const handle of handles) {
    const hl = handle.toLowerCase();
    const member = parseMemberHtml(await get(`member-${hl}.html`, () => fetch(`${BASE}/member/${handle}/`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })));
    if (!member.userId) { console.error(`${handle}: no data-user-id on the member page; skipped`); continue; }
    const cards = new Map(member.cards.map((c) => [c.url, { ...c, page: 1 }]));
    let page = member.nextPage ?? 2;
    for (let guard = 0; guard < 500 && member.nextPage; guard++) {
      const body = new URLSearchParams({ action: 'bat_profile_more_items', itemType: 'listings_past', itemPaged: String(page), userID: member.userId });
      const j = parseAjax(await get(`ajax-${hl}-${page}.json`, () => fetch(`${BASE}/wp-admin/admin-ajax.php`, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(30000) })));
      for (const c of j.cards) if (!cards.has(c.url)) cards.set(c.url, { ...c, page });
      if (!j.more || !j.nextPage || j.nextPage === page) break;
      page = j.nextPage;
    }
    console.error(`${handle}: user ${member.userId}, ${cards.size} listings`);
    let n = 0;
    for (const c of cards.values()) {
      if (limit && n++ >= limit) break;
      const d = parseDetail(await get(`listing-${listingSlug(c.url)}.html`, () => fetch(c.url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })));
      rows.push({ handle: hl, bat_user_id: member.userId, url: c.url, page: c.page, ...d,
        title: d.title ?? c.title, end_date: d.end_date ?? c.end_date, result: d.result ?? c.result,
        seller_username: d.seller_username ?? null, fetched_with: PRODUCER });
    }
  }
  writeFileSync(out, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''));
  if (valuesOut) writeFileSync(valuesOut, buildValuesSql(rows));
  console.error(`wrote ${rows.length} rows to ${out}${valuesOut ? ` and ${valuesOut}` : ''} (run ${runId}; ${apply ? 'APPLY' : 'dry run, no database write'})`);
  if (apply) {
    const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? PROJECT_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!key) { console.error('--apply needs SUPABASE_SERVICE_ROLE_KEY'); process.exit(2); }
    const res = await fetch(`${url}/rest/v1/bat_listings?on_conflict=bat_listing_url`, { method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' },
      body: JSON.stringify(rows.map((r) => toBatListingRow(r, runId))) });
    console.error(res.ok ? `upserted (additive) ${rows.length} rows` : `upsert failed: ${res.status} ${await res.text()}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e.message); process.exit(1); });
