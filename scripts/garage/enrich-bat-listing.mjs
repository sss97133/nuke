#!/usr/bin/env node
// Reads public BaT listing detail pages and appends what they show to listing_detail_enrichments (append-only, run_id).
// bat_listings is never written. The matcher (match_bat_listings_to_vehicles / derive_vehicle_relationships) then matches by VIN.
//
//   node scripts/garage/enrich-bat-listing.mjs --parse-only https://bringatrailer.com/listing/1978-gmc-k1500-8/   (fetch + print, no database)
//   dotenvx run -- node scripts/garage/enrich-bat-listing.mjs --limit 20            (dry run: listings without enrichment, parsed, printed)
//   dotenvx run -- node scripts/garage/enrich-bat-listing.mjs --limit 20 --apply    (append rows)
//
// Polite: one request every --delay-ms (default 3000), identifying user agent, stops on 403/429. Only bringatrailer.com listing URLs.
// Parses: title (<h1>), Lot # (the "Lot #" text), Chassis (the "Chassis:" link), Seller (the "Seller" link). Seller handles are
// stored lowercased and compare case-insensitively. Example: /listing/1978-gmc-k1500-8/ -> lot 255909, chassis TKL148F714125,
// seller VivaLasVegasAutos (stored vivalasvegasautos).
import { createHash, randomUUID } from 'node:crypto';

const UA = 'NukeResearchBot/1.0 (+https://nuke.ag; listing detail enrichment; contact via site)';
const strip = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export function parseBatListing(html) {
  const title = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i) || [])[1];
  const lot = ((html.match(/Lot(?:<[^>]*>|[\s:])*#\s*(\d{1,3}(?:,\d{3})+|\d{3,8})/i) || [])[1] || '').replace(/,/g, '') || undefined;
  // the "Chassis:" label is followed by a link whose text is the chassis / VIN
  const chassis = (html.match(/Chassis(?:<[^>]*>|[\s:])*<a[^>]*>\s*([A-Za-z0-9-]{5,20})\s*<\/a>/i)
    || html.match(/Chassis(?:<[^>]*>|[\s:])+([A-Za-z0-9-]{5,20})/i) || [])[1];
  // the "Seller" label is followed by a link to the member page; the link text is the handle as displayed
  const seller = html.match(/Seller(?:<[^>]*>|[\s:])*<a[^>]*href="[^"]*\/member\/([^"\/]+)\/?"[^>]*>\s*([^<]+?)\s*<\/a>/i)
    || html.match(/Seller(?:<[^>]*>|[\s:])*<a[^>]*>\s*([^<]+?)\s*<\/a>/i) || [];
  const handle = seller.length === 3 ? seller[2] : seller[1];
  return {
    title: title ? strip(title) : null,
    lot_number: lot ?? null,
    chassis: chassis ? chassis.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : null,
    seller_username: handle ? strip(handle).toLowerCase() : null,
  };
}

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const delay = Number(opt('delay-ms', 3000));
const okUrl = (u) => /^https:\/\/(www\.)?bringatrailer\.com\/listing\/[a-z0-9-]+\/?$/i.test(u);

async function fetchPage(u) {
  const res = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow' });
  const html = res.ok ? await res.text() : '';
  return { status: res.status, html };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const parseOnly = args.indexOf('--parse-only');
  if (parseOnly >= 0) {
    const u = args[parseOnly + 1];
    if (!okUrl(u ?? '')) { console.error('a https://bringatrailer.com/listing/<slug>/ URL is required'); process.exit(2); }
    const { status, html } = await fetchPage(u);
    console.log(JSON.stringify({ url: u, status, ...parseBatListing(html) }, null, 2));
    process.exit(status === 200 ? 0 : 1);
  }
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL; const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required (run under dotenvx)'); process.exit(2); }
  const apply = args.includes('--apply'); const limit = Math.min(Number(opt('limit', 20)), 200); const runId = randomUUID();
  const h = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const rest = (path, init = {}) => fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...h, ...(init.headers ?? {}) } });
  // listings that have no active enrichment yet (newest first); bat_listings is only read
  const have = new Set((await (await rest('listing_detail_enrichments?select=listing_url&superseded_at=is.null&limit=100000')).json()).map((r) => r.listing_url));
  const rows = await (await rest(`bat_listings?select=id,bat_listing_url&bat_listing_url=not.is.null&order=scraped_at.desc.nullslast&limit=${limit * 5}`)).json();
  const todo = rows.filter((r) => okUrl(r.bat_listing_url) && !have.has(r.bat_listing_url)).slice(0, limit);
  let n = 0;
  for (const r of todo) {
    const { status, html } = await fetchPage(r.bat_listing_url);
    if (status === 403 || status === 429) { console.error(`stopping: HTTP ${status}`); break; }
    const p = status === 200 ? parseBatListing(html) : {};
    console.log(`${apply ? 'append' : 'would append'} ${r.bat_listing_url} status=${status} ${JSON.stringify(p)}`);
    if (apply && status === 200 && (p.chassis || p.lot_number || p.seller_username)) {
      const res = await rest('listing_detail_enrichments', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({
        listing_id: r.id, listing_url: r.bat_listing_url, lot_number: p.lot_number, chassis: p.chassis, seller_username: p.seller_username,
        title: p.title, http_status: status, content_sha256: createHash('sha256').update(html).digest('hex'),
        run_id: runId, producer_version: 'enrich-bat-listing/1' }) });
      if (!res.ok) console.error(`  insert failed: ${res.status} ${await res.text()}`); else n++;
    }
    await sleep(delay);
  }
  console.log(`${apply ? `appended ${n}` : 'dry run: nothing written'} (run ${runId})`);
}
