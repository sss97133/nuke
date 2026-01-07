#!/usr/bin/env node
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const UA = 'Mozilla/5.0 (compatible; NukeBot/1.0)';
const FIRECRAWL_API_KEY = (process.env.FIRECRAWL_API_KEY || '').trim();

async function fetchHtml(url, allowFirecrawl = false) {
  const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
  if (res.ok) return await res.text();
  const status = res.status;
  if (!allowFirecrawl || !FIRECRAWL_API_KEY) {
    throw new Error(`Fetch failed ${status} ${res.statusText}`);
  }
  // Fallback to Firecrawl to bypass blocks
  const fc = await fetch('https://api.firecrawl.dev/v0/scrape', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${FIRECRAWL_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      url,
      formats: ['html'],
      onlyMainContent: false,
      waitFor: 3000
    })
  });
  if (!fc.ok) throw new Error(`Fetch failed ${status} and Firecrawl ${fc.status}`);
  const data = await fc.json();
  const html = data?.data?.html || data?.data?.content || '';
  if (!html) throw new Error('Firecrawl returned empty html');
  return html;
}

function extractBat(html, url) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = (titleMatch?.[1] || '').replace(/\s*\|\s*Bring a Trailer.*$/i, '').trim();
  const yearMatch = title.match(/(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  const rest = title.replace(yearMatch ? yearMatch[0] : '', '').trim();
  const parts = rest.split(/\s+/);
  const make = parts.length > 0 ? parts[0].replace(/[^A-Za-z0-9]/g, '') : '';
  const model = parts.slice(1).join(' ').trim();
  if (!year || !make || !model) throw new Error('BaT parse failed (core fields)');

  let price = null;
  const bidMatch = html.match(/Current Bid:?[^$]*\$([\d,]+)/i) || html.match(/Sold for[^$]*\$([\d,]+)/i);
  if (bidMatch) price = parseInt(bidMatch[1].replace(/,/g, ''), 10);

  // Try __NEXT_DATA__ for price fields
  const nd = parseNextData(html);
  const listing = nd?.props?.pageProps?.pageData?.listing || nd?.props?.pageProps?.listing || null;
  const priceFields = [
    listing?.sale_price,
    listing?.salePrice,
    listing?.final_bid,
    listing?.finalBid,
    listing?.current_bid,
    listing?.currentBid,
    listing?.high_bid,
    listing?.highBid
  ].filter((v) => v !== undefined && v !== null);
  if (!price && priceFields.length > 0) {
    const val = priceFields.find((v) => typeof v === 'number') || priceFields.find((v) => typeof v === 'string');
    if (val) price = typeof val === 'number' ? val : parseFloat(String(val).replace(/,/g, ''));
  }

  let description = '';
  const descMatch = html.match(/<div[^>]+class="listing\-body"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!description) {
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i);
    if (og) description = og[1].trim();
  }
  if (!description) {
    const ld = html.match(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/i);
    if (ld) {
      try {
        const obj = JSON.parse(ld[1]);
        if (obj?.description) description = String(obj.description).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      } catch {
        // ignore
      }
    }
  }
  if (!description) {
    const bodyText = html.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ');
    description = bodyText.replace(/\s+/g, ' ').trim().slice(0, 2000);
  }
  if (!description) description = title;

  return { year, make, model, asking_price: price, mileage: null, description, source: 'Bring a Trailer' };
}

function extractKsl(html, url) {
  const titleMatch = html.match(/<h1[^>]*>([^<]+)<\/h1>/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = (titleMatch?.[1] || '').replace(/\s*\|\s*KSL.*$/i, '').trim();
  const yearMatch = rawTitle.match(/^(19|20)\d{2}/);
  const year = yearMatch ? parseInt(yearMatch[0]) : null;
  const rest = rawTitle.replace(yearMatch ? yearMatch[0] : '', '').trim();
  const parts = rest.split(/\s+/);
  const make = parts.length > 0 ? parts[0] : '';
  const model = parts.slice(1).join(' ').trim();
  if (!make || !model) throw new Error('KSL parse failed (core fields)');

  let price = null;
  const priceMatch = html.match(/\$[\s]*([\d,]+)\s*<\/[^>]*price/i) || html.match(/itemprop="price"[^>]*content="([\d.]+)"/i);
  if (priceMatch) price = parseInt(priceMatch[1].replace(/,/g, ''), 10);

  let mileage = null;
  const milMatch = html.match(/Mileage[^0-9]*([\d,]+)\s*miles?/i);
  if (milMatch) mileage = parseInt(milMatch[1].replace(/,/g, ''), 10);

  let description = '';
  const descMatch = html.match(/<div[^>]+class="description"[^>]*>([\s\S]*?)<\/div>/i);
  if (descMatch) description = descMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  if (!description) description = rawTitle;

  return { year, make, model, asking_price: price, mileage, description, source: 'cars.ksl.com' };
}

function needsUpdate(row) {
  const bad = (v) => v === null || v === '' || (typeof v === 'string' && ['unknown', 'unk'].includes(v.toLowerCase()));
  return bad(row.make) || bad(row.model) || row.year === null || row.description === null || row.description === '' || !row.asking_price || row.asking_price === 0;
}

function buildUpdate(existing, parsed) {
  const bad = (v) => v === null || v === '' || (typeof v === 'string' && ['unknown', 'unk'].includes(v.toLowerCase()));
  const update = {};
  if (parsed.year && (!existing.year || existing.year === 0)) update.year = parsed.year;
  if (parsed.make && bad(existing.make)) update.make = parsed.make;
  if (parsed.model && bad(existing.model)) update.model = parsed.model;
  if (parsed.asking_price && (!existing.asking_price || existing.asking_price === 0)) update.asking_price = parsed.asking_price;
  if (parsed.mileage && (!existing.mileage || existing.mileage === 0)) update.mileage = parsed.mileage;
  if (parsed.description && (!existing.description || existing.description.trim() === '')) update.description = parsed.description;
  if (parsed.source && (!existing.source || existing.source === 'process_import_queue_simple')) update.source = parsed.source;
  return update;
}

function parseNextData(html) {
  const nextDataMatch = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (!nextDataMatch) return null;
  try {
    return JSON.parse(nextDataMatch[1]);
  } catch {
    return null;
  }
}

function parseBatState(html) {
  const state = parseNextData(html);
  if (!state) return { comments: [], bids: [], listing: null };
  const pageData = state?.props?.pageProps?.pageData || state?.props?.pageProps || {};
  const listing = pageData.listing || pageData;
  const comments = pageData.comments || listing?.comments || [];
  const bids = pageData.bids || listing?.bids || [];
  return { comments, bids, listing };
}

function parseBatComments(html) {
  const comments = [];
  let maxBid = null;
  let soldPrice = null;
  let reserveNotMet = false;

  // Try embedded script with comments array (legacy)
  const match = html.match(/"comments":\s*\[([\s\S]*?)\](?=,"[a-z])/);
  if (match) {
    const jsonStr = '[' + match[1] + ']';
    try {
      const arr = JSON.parse(jsonStr);
      for (const c of arr) {
        const author = String(c?.authorName || '').replace(/\s*\(The Seller\)\s*/i, '').trim();
        const isSeller = String(c?.authorName || '').toLowerCase().includes('(the seller)');
        const ts = c?.timestamp ? new Date(c.timestamp * 1000).toISOString() : null;
        const text = String(c?.content || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const bidAmount = c?.type === 'bat-bid' && typeof c?.bidAmount === 'number' ? c.bidAmount : null;
        if (bidAmount && (maxBid === null || bidAmount > maxBid)) maxBid = bidAmount;
        if (/sold for\s*\$[\d,]+/i.test(text)) {
          const m = text.match(/sold for\s*\$([\d,]+)/i);
          if (m) soldPrice = parseInt(m[1].replace(/,/g, ''), 10);
        }
        if (/reserve not met/i.test(text)) reserveNotMet = true;
        comments.push({
          author_username: author || null,
          is_seller: isSeller,
          posted_at: ts,
          comment_text: text,
          bid_amount: bidAmount,
          comment_type: bidAmount ? 'bid' : 'observation'
        });
      }
      return { comments, maxBid, soldPrice, reserveNotMet };
    } catch {
      // fall through to other strategies
    }
  }

  // Try embedded JSON in __NEXT_DATA__
  const { comments: ndComments, bids: ndBids, listing } = parseBatState(html);
  const mergeComments = (arr) => {
    for (const c of arr) {
      const author = String(c?.authorName || c?.author || '').replace(/\s*\(The Seller\)\s*/i, '').trim();
      const isSeller = String(c?.authorName || c?.author || '').toLowerCase().includes('(the seller)');
      const ts = c?.timestamp ? new Date(c.timestamp * 1000).toISOString() : null;
      const text = String(c?.content || c?.comment || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      const bidAmount = c?.bidAmount ?? c?.amount ?? null;
      const bidNum = typeof bidAmount === 'number' ? bidAmount : (typeof bidAmount === 'string' && bidAmount.match(/^\d/)) ? parseFloat(bidAmount.replace(/,/g, '')) : null;
      if (bidNum && (maxBid === null || bidNum > maxBid)) maxBid = bidNum;
      if (/sold for\s*\$[\d,]+/i.test(text)) {
        const m = text.match(/sold for\s*\$([\d,]+)/i);
        if (m) soldPrice = parseInt(m[1].replace(/,/g, ''), 10);
      }
      if (/reserve not met/i.test(text)) reserveNotMet = true;
      comments.push({
        author_username: author || null,
        is_seller: isSeller,
        posted_at: ts,
        comment_text: text,
        bid_amount: bidNum,
        comment_type: bidNum ? 'bid' : 'observation'
      });
    }
  };
  if (ndComments && Array.isArray(ndComments)) mergeComments(ndComments);
  // Also consider bids array if present
  if (ndBids && Array.isArray(ndBids)) {
    for (const b of ndBids) {
      const author = String(b?.username || b?.bidder || '').trim();
      const ts = b?.timestamp ? new Date(b.timestamp * 1000).toISOString() : null;
      const bidNum = typeof b?.amount === 'number' ? b.amount : (typeof b?.amount === 'string' && b.amount.match(/^\d/)) ? parseFloat(b.amount.replace(/,/g, '')) : null;
      if (bidNum && (maxBid === null || bidNum > maxBid)) maxBid = bidNum;
      comments.push({
        author_username: author || null,
        is_seller: false,
        posted_at: ts,
        comment_text: '',
        bid_amount: bidNum,
        comment_type: 'bid'
      });
    }
  }
  // Infer sold price from listing if available
  if (!soldPrice && listing) {
    const sale = listing.sale_price || listing.salePrice || listing.final_bid || listing.finalBid || listing.high_bid || listing.highBid;
    if (sale) soldPrice = typeof sale === 'number' ? sale : parseFloat(String(sale).replace(/,/g, ''));
    const resFlag = listing.reserve_status || listing.reserveStatus || '';
    if (typeof resFlag === 'string' && resFlag.toLowerCase().includes('not met')) reserveNotMet = true;
  }

  // As a last resort, no comments extracted
  return { comments, maxBid, soldPrice, reserveNotMet };
}

async function processBatch(source, limit = 50) {
  const like = source === 'bat' ? '%bringatrailer.com%' : '%cars.ksl.com%';
  const { data, error } = await supabase
    .from('vehicles')
    .select('id, discovery_url, make, model, year, asking_price, mileage, description, source')
    .ilike('discovery_url', like)
    .or('make.is.null,make.eq.,model.is.null,model.eq.,year.is.null,description.is.null,description.eq.,asking_price.is.null,asking_price.eq.0')
    .limit(limit);

  if (error) throw error;
  if (!data || data.length === 0) return { processed: 0, updated: 0, skipped: 0, errors: 0 };

  let processed = 0, updated = 0, skipped = 0, errors = 0;

  for (const row of data) {
    processed++;
    if (!needsUpdate(row)) { skipped++; continue; }
    try {
      const html = await fetchHtml(row.discovery_url, source === 'ksl');
      const parsed = source === 'bat' ? extractBat(html, row.discovery_url) : extractKsl(html, row.discovery_url);
      if (source === 'bat') {
        const { comments, maxBid, soldPrice } = parseBatComments(html);
        // Upsert comments (replace for this source_url)
        if (comments.length > 0) {
          await supabase.from('auction_comments').delete().eq('source_url', row.discovery_url);
          const insertRows = comments.map((c, idx) => ({
            vehicle_id: row.id,
            platform: 'bringatrailer',
            source_url: row.discovery_url,
            comment_type: c.comment_type,
            posted_at: c.posted_at,
            sequence_number: idx + 1,
            author_username: c.author_username,
            is_seller: c.is_seller,
            comment_text: c.comment_text,
            bid_amount: c.bid_amount
          }));
          const { error: insErr } = await supabase.from('auction_comments').insert(insertRows);
          if (insErr) console.error(`comment insert error for ${row.id}: ${insErr.message}`);
        }
        if ((!row.asking_price || row.asking_price === 0)) {
          if (soldPrice) parsed.asking_price = soldPrice;
          else if (maxBid) parsed.asking_price = maxBid;
        }
      }
      const update = buildUpdate(row, parsed);
      if (Object.keys(update).length === 0) { skipped++; continue; }
      const { error: updErr } = await supabase
        .from('vehicles')
        .update(update)
        .eq('id', row.id);
      if (updErr) throw updErr;
      updated++;
      console.log(`✔️  ${row.id} updated (${row.discovery_url})`);
    } catch (e) {
      errors++;
      console.error(`❌ ${row.id} ${row.discovery_url}: ${e.message}`);
      continue;
    }
  }

  return { processed, updated, skipped, errors };
}

async function main() {
  const sourceArg = process.argv.find(a => a.startsWith('--source=')) || '';
  const source = sourceArg.split('=')[1] || 'both'; // bat | ksl | both
  const limitArg = process.argv.find(a => a.startsWith('--limit=')) || '';
  const limit = parseInt(limitArg.split('=')[1]) || 50;

  const sources = source === 'both' ? ['bat', 'ksl'] : [source];
  for (const s of sources) {
    console.log(`\n== Backfill ${s.toUpperCase()} (limit ${limit}) ==`);
    const result = await processBatch(s, limit);
    console.log(result);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

