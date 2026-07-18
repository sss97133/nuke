#!/usr/bin/env node
/**
 * fb-fast-lane.mjs — the deal catcher. FB Marketplace, year-tiered.
 *
 * FB is where the deals are (CL dropped). Filter is YEARS, not a keyword list:
 *   Tier 1  ≤1973        priority — age alone makes it a catch (chrome-bumper classics)
 *   Tier 2  1974–1991    squarebody / OBS / early-malaise era
 *   Tier 3  1992+        SNIPE ONLY — rare/unique models + creampuffs (low-miles, survivor,
 *                        1-owner, collector models). Not broad.
 *
 * Source: FB GraphQL feed (doc_id 33269364996041474 — the HTML scrape method is dead). Uses FB's
 * own comparable_price as a free below-market signal; deals sort to the top. Fires INSTANT Telegram
 * on new matches. Skylar is the key: he taps through and messages the seller. No auto-buy.
 *
 *   node scripts/fb-fast-lane.mjs           # one pass
 *   node scripts/fb-fast-lane.mjs --prime   # record current matches silently (use when retuning)
 *   node scripts/fb-fast-lane.mjs --test    # send a test Telegram
 */

import fs from 'node:fs';
import path from 'node:path';

const SEEN_FILE = '/Users/skylar/nuke/logs/fast-lane-seen.json';
const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const TG_CHAT = process.env.TELEGRAM_CHAT_ID || '';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const METROS = [
  { name: 'Las Vegas', lat: 36.17, lng: -115.14, fb: 'las-vegas' },
  { name: 'Henderson', lat: 36.04, lng: -114.982, fb: 'henderson' },
  { name: 'St George UT', lat: 37.10, lng: -113.58, fb: 'st-george' },
  { name: 'Phoenix', lat: 33.45, lng: -112.07, fb: 'phoenix' },
  { name: 'Los Angeles', lat: 34.05, lng: -118.24, fb: 'los-angeles' },
  { name: 'Riverside', lat: 33.95, lng: -117.40, fb: 'riverside' },
];
const RADIUS_M = 80000, FB_PAGES = 4;

// SKYLAR'S FLIP LANE — mirrors the WATCHLIST in fb-watchlist-scraper.ts. The lane is the gate.
// We are NOT the judge of the deal (his eye is the edge). We surface in-lane, under-ceiling
// listings fast; he taps and messages the seller. Year is REQUIRED and must fall in-window so a
// modern Silverado/F150 can't sneak in on a model token. priceMax leaves flip headroom; a missing
// drivetrain ("no engine, $10K") is the deal, not a disqualifier — never gate on condition.
// Edit this array freely — it's the whole filter.
const LANE = [
  { name: 'Squarebody Chevy/GMC', yr: [1967, 1991], priceMax: 25000, models: [
    /\bsquare\s?body\b/, /\bc-?10\b/, /\bk-?10\b/, /\bc-?20\b/, /\bk-?20\b/, /\bc-?30\b/, /\bk-?30\b/,
    /\bk-?5\b/, /\bblazer\b/, /\bjimmy\b/, /\bscottsdale\b/, /\bcheyenne\b/, /\bsilverado\b/, /\bc\/?k\b/,
  ] },
  { name: 'Squarebody Suburban', yr: [1967, 1991], priceMax: 25000, models: [/\bsuburban\b/] },
  { name: 'First-Gen Cummins', yr: [1989, 1993], priceMax: 30000, models: [
    /\bcummins\b/, /\bw-?250\b/, /\bd-?250\b/, /\bw-?350\b/, /12\s?valve/,
  ] },
  { name: 'OBS Ford', yr: [1992, 1997], priceMax: 30000, models: [
    /\bobs\b/, /\bf-?150\b/, /\bf-?250\b/, /\bf-?350\b/, /7\.?3\b/, /power\s?stroke/,
  ] },
  { name: 'Classic 4x4 / Land Cruiser', yr: [1960, 1996], priceMax: 30000, models: [
    /\bfj-?40\b/, /\bfj-?45\b/, /\bfj-?55\b/, /\bfj-?60\b/, /\bfj-?62\b/, /\bfj-?80\b/, /land\s?cruiser/,
    /\bbronco\b/, /\bscout\b/, /\b4runner\b/, /\bpower\s?wagon\b/,
  ] },
];

const num = (v) => { const n = parseFloat(String(v ?? '').replace(/[^0-9.]/g, '')); return Number.isFinite(n) ? n : null; };
const parseYear = (t) => { const m = (t || '').match(/\b(19[2-9]\d|20[0-2]\d)\b/); return m ? parseInt(m[1]) : null; };

/** Lane gate. Returns {lane, era, priceMax} for an in-lane vehicle, else null.
 *  Requires a model-token hit AND a year inside that lane's window. */
function classify(title, year, priceNum) {
  if (!year) return null; // FB nearly always has the year; no year → can't bound the lane safely
  const t = (title || '').toLowerCase();
  for (const L of LANE) {
    if (year < L.yr[0] || year > L.yr[1]) continue;
    if (!L.models.some((re) => re.test(t))) continue;
    if (priceNum && priceNum > L.priceMax) return null; // out of flip range — not for us
    return { lane: L.name, era: `${year}`, priceMax: L.priceMax };
  }
  return null;
}

async function tg(text, imageUrl) {
  if (!TG_TOKEN || !TG_CHAT) { console.log('[no telegram]', text.slice(0, 70)); return; }
  try {
    const fn = imageUrl ? 'sendPhoto' : 'sendMessage';
    const payload = imageUrl
      ? { chat_id: TG_CHAT, photo: imageUrl, caption: text, parse_mode: 'HTML' }
      : { chat_id: TG_CHAT, text, parse_mode: 'HTML', disable_web_page_preview: false };
    await fetch(`https://api.telegram.org/bot${TG_TOKEN}/${fn}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  } catch (e) { console.error('telegram err', e.message); }
}

async function fbPage(metro, cursor) {
  const variables = {
    buyLocation: { latitude: metro.lat, longitude: metro.lng }, categoryIDArray: [807311116002614],
    contextual_data: [], count: 24, cursor, marketplaceBrowseContext: 'CATEGORY_FEED',
    numericVerticalFields: [], numericVerticalFieldsBetween: [], priceRange: [0, 214748364700],
    radius: RADIUS_M, scale: 2, stringVerticalFields: [], topicPageParams: { location_id: metro.fb, url: 'vehicles' },
  };
  const body = new URLSearchParams({ doc_id: '33269364996041474', variables: JSON.stringify(variables), __a: '1', __comet_req: '15', server_timestamps: 'true' });
  const resp = await fetch('https://www.facebook.com/api/graphql/', {
    method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '*/*', Origin: 'https://www.facebook.com', Referer: `https://www.facebook.com/marketplace/${metro.fb}/vehicles/`, 'sec-fetch-site': 'same-origin' }, body: body.toString(),
  });
  if (!resp.ok) throw new Error(`FB HTTP ${resp.status}`);
  const json = JSON.parse((await resp.text()).replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, ''));
  if (json?.errors) throw new Error(`FB GraphQL ${json.errors[0]?.code}`);
  const feed = json?.data?.viewer?.marketplace_feed_stories;
  return { edges: feed?.edges || [], next: feed?.page_info?.has_next_page ? feed?.page_info?.end_cursor : null };
}
function fbItem(edge, metro) {
  const l = edge?.node?.listing || {};
  const title = l.marketplace_listing_title || '';
  const priceNum = num(l.listing_price?.amount), compNum = num(l.comparable_price?.amount);
  let dealPct = null; if (priceNum && compNum && compNum > 0 && priceNum < compNum) dealPct = Math.round((1 - priceNum / compNum) * 100);
  return {
    id: l.id, title, priceNum, price: l.listing_price?.formatted_amount || (priceNum ? `$${priceNum.toLocaleString()}` : null),
    comp: l.comparable_price?.formatted_amount || null, dealPct, year: parseYear(title),
    justListed: !!l.if_gk_just_listed_tag_on_search_feed, sold: !!l.is_sold, pending: !!l.is_pending,
    url: l.id ? `https://www.facebook.com/marketplace/item/${l.id}` : null,
    image: l.primary_listing_photo?.image?.uri || null, city: l.location?.reverse_geocode?.city || metro.name,
  };
}

async function main() {
  if (process.argv.includes('--test')) { await tg('🚨 <b>FAST LANE TEST</b>\nYear-tiered FB catcher can reach your phone.'); console.log('test sent'); return; }
  let seen = {}; try { seen = JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')); } catch {}
  let scanned = 0; const matches = [];
  for (const metro of METROS) {
    let cursor = null;
    for (let p = 0; p < FB_PAGES; p++) {
      let page; try { page = await fbPage(metro, cursor); } catch (e) { console.error(`FB ${metro.name} p${p}:`, e.message); break; }
      for (const edge of page.edges) {
        const it = fbItem(edge, metro); if (!it.id) continue; scanned++;
        if (it.sold || it.pending) continue;
        const c = classify(it.title, it.year, it.priceNum); if (!c) continue;
        if (seen[it.id]) continue;
        seen[it.id] = { first_seen: new Date().toISOString(), era: c.era, title: it.title };
        matches.push({ ...it, ...c });
      }
      cursor = page.next; if (!cursor) break;
    }
  }
  // biggest below-comp deal first, then fresh, then cheapest (his eye does the rest)
  matches.sort((a, b) => (b.dealPct || 0) - (a.dealPct || 0) || (b.justListed - a.justListed) || (a.priceNum || 1e9) - (b.priceNum || 1e9));
  const PRIME = process.argv.includes('--prime'), MAX_ALERTS = 12;
  if (PRIME) { console.log(`PRIME: recorded ${matches.length} in-lane matches silently`); }
  else {
    for (const m of matches.slice(0, MAX_ALERTS)) {
      const hot = m.dealPct && m.dealPct >= 15;
      const head = `${hot ? '🔥' : '🚨'} <b>${m.lane}</b> · ${m.era}${m.justListed ? ' · fresh' : ''}`;
      const dealLine = m.dealPct ? `\n📉 <b>${m.dealPct}% under</b> FB comp ${m.comp || ''}` : '';
      const msg = `${head}\n\n<b>${m.title}</b>\n💰 ${m.price || 'see listing'}${dealLine}\n📍 ${m.city}\n\n<a href="${m.url}">Open + message the seller →</a>`;
      await tg(msg, m.image || undefined);
      console.log(`ALERT${hot ? ' 🔥' : ''} [${m.lane} ${m.era}]: ${m.title} ${m.price || ''}${m.dealPct ? ` (${m.dealPct}% under)` : ''}`);
    }
    if (matches.length > MAX_ALERTS) console.log(`(capped: ${matches.length - MAX_ALERTS} more held)`);
  }
  fs.mkdirSync(path.dirname(SEEN_FILE), { recursive: true });
  fs.writeFileSync(SEEN_FILE, JSON.stringify(seen, null, 2));
  console.log(`fast-lane: scanned ${scanned}, ${matches.length} new in-lane matches, ${Object.keys(seen).length} tracked`);
}

main().catch((e) => { console.error(e); process.exit(1); });
