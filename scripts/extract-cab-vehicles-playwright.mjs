/**
 * extract-cab-vehicles-playwright.mjs
 *
 * Full C&B vehicle extractor using Playwright (replaces Firecrawl-based extract-cars-and-bids-core).
 * Processes import_queue URLs → creates vehicles, images, external_listings, auction_events, bids.
 *
 * Usage:
 *   dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs --queue --limit 500
 *   dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs --file urls.txt
 *   dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs <URL>
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync } from 'fs';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseKey);

const CAB_SOURCE_ID = '3422b660-3233-47a4-b44e-97e23bf9e9cb';
const CAB_ORG_ID = '4dac1878-b3fc-424c-9e92-3cf552f1e053';

// ─── Extract all vehicle data from C&B page ────────────────────────

async function extractVehicleData(page) {
  return page.evaluate(() => {
    const data = {
      title: null, year: null, make: null, model: null,
      vin: null, mileage: null, transmission: null,
      exteriorColor: null, interiorColor: null,
      engine: null, bodyStyle: null, drivetrain: null,
      location: null, sellerName: null, sellerType: null,
      currentBid: null, auctionStatus: null, endDate: null,
      bidCount: null, commentCount: null,
      dougsTake: null, highlights: null, equipment: null,
      images: [], lotNumber: null,
    };

    // ── Title from H1 ──
    const h1 = document.querySelector('h1');
    if (h1) {
      const text = h1.textContent.trim();
      data.title = text;
      const ymm = text.match(/^(\d{4})\s+(\S+)\s+(.+)$/);
      if (ymm) {
        data.year = parseInt(ymm[1], 10);
        data.make = ymm[2];
        data.model = ymm[3];
      }
    }

    // ── og:title fallback ──
    if (!data.year) {
      const ogTitle = document.querySelector('meta[property="og:title"]');
      if (ogTitle) {
        const c = ogTitle.getAttribute('content') || '';
        const ymm = c.match(/^(\d{4})\s+(\S+)\s+([^-]+)/);
        if (ymm) {
          data.year = parseInt(ymm[1], 10);
          data.make = ymm[2].trim();
          data.model = ymm[3].trim();
          data.title = `${data.year} ${data.make} ${data.model}`;
        }
        // Mileage from og:title
        const miles = c.match(/~?([\d,]+)\s*Miles/i);
        if (miles) data.mileage = parseInt(miles[1].replace(/,/g, ''), 10);
        // Transmission from og:title
        const trans = c.match(/(\d+-Speed\s+(?:Manual|Automatic)|Manual|Automatic)/i);
        if (trans) data.transmission = trans[1];
      }
    }

    // ── Specs from the quick-facts / details section ──
    // C&B uses dl or table-like structure for specs
    const specPairs = [];

    // Try dl.quick-facts dt/dd pairs
    document.querySelectorAll('dl dt, dl.quick-facts dt').forEach(dt => {
      const dd = dt.nextElementSibling;
      if (dd && dd.tagName === 'DD') {
        specPairs.push([dt.textContent.trim(), dd.textContent.trim()]);
      }
    });

    // Also try .detail-item or .specs-table patterns
    document.querySelectorAll('.detail-item, .specs-item, .listing-detail').forEach(el => {
      const label = el.querySelector('.label, .key, dt');
      const value = el.querySelector('.value, dd');
      if (label && value) {
        specPairs.push([label.textContent.trim(), value.textContent.trim()]);
      }
    });

    // Try table rows in specs sections
    document.querySelectorAll('table tr').forEach(tr => {
      const cells = tr.querySelectorAll('td, th');
      if (cells.length >= 2) {
        specPairs.push([cells[0].textContent.trim(), cells[1].textContent.trim()]);
      }
    });

    // Process spec pairs
    for (const [label, value] of specPairs) {
      const lbl = label.toLowerCase().replace(/[:\s]+/g, '');
      if (lbl.includes('vin') && !data.vin) {
        const vinMatch = value.match(/([A-HJ-NPR-Z0-9]{17})/i);
        if (vinMatch) data.vin = vinMatch[1].toUpperCase();
      }
      if (lbl.includes('mileage') && !data.mileage) {
        const m = parseInt(value.replace(/[^0-9]/g, ''), 10);
        if (m > 0 && m < 999999) data.mileage = m;
      }
      if (lbl.includes('transmission') && !data.transmission) data.transmission = value;
      if (lbl.includes('exteriorcolor') && !data.exteriorColor) data.exteriorColor = value;
      if (lbl.includes('interiorcolor') && !data.interiorColor) data.interiorColor = value;
      if (lbl.includes('engine') && !data.engine) data.engine = value;
      if (lbl.includes('bodystyle') && !data.bodyStyle) data.bodyStyle = value;
      if (lbl.includes('drivetrain') && !data.drivetrain) data.drivetrain = value;
      if (lbl.includes('location') && !data.location) data.location = value;
      if ((lbl === 'seller' || lbl === 'sellername') && !data.sellerName) {
        const link = value;
        data.sellerName = link;
      }
      if (lbl.includes('sellertype') && !data.sellerType) data.sellerType = value;
    }

    // ── VIN from page text (fallback) ──
    if (!data.vin) {
      const bodyText = document.body.innerText || '';
      const vinMatch = bodyText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) data.vin = vinMatch[1].toUpperCase();
    }

    // ── Auction status + bid ──
    const bodyText = document.body.innerText || '';

    // Check sold/ended status
    const soldMatch = bodyText.match(/Sold\s+(?:for|For)\s+\$?([\d,]+)/i);
    if (soldMatch) {
      data.auctionStatus = 'sold';
      data.currentBid = parseInt(soldMatch[1].replace(/,/g, ''), 10);
    }
    if (!data.auctionStatus && bodyText.includes('Reserve Not Met')) {
      data.auctionStatus = 'reserve_not_met';
    }
    if (!data.auctionStatus && (bodyText.includes('Auction Ended') || bodyText.includes('This auction has ended'))) {
      data.auctionStatus = 'ended';
    }

    // Current/High bid
    if (!data.currentBid) {
      const bidEl = document.querySelector('.bid-value, .current-bid, [data-current-bid]');
      if (bidEl) {
        const bidMatch = bidEl.textContent.match(/\$?([\d,]+)/);
        if (bidMatch) data.currentBid = parseInt(bidMatch[1].replace(/,/g, ''), 10);
      }
    }
    if (!data.currentBid) {
      const highBidMatch = bodyText.match(/(?:High\s*Bid|Bid\s*to|Current\s*Bid)[:\s]*\$?([\d,]+)/i);
      if (highBidMatch) data.currentBid = parseInt(highBidMatch[1].replace(/,/g, ''), 10);
    }

    // Bid count
    const bidCountMatch = bodyText.match(/(\d+)\s*bids?/i);
    if (bidCountMatch) data.bidCount = parseInt(bidCountMatch[1], 10);

    // Comment count
    const commentCountMatch = bodyText.match(/(\d+)\s*comments?/i);
    if (commentCountMatch) data.commentCount = parseInt(commentCountMatch[1], 10);

    // End date from countdown
    const countdownEl = document.querySelector('[data-countdown-date], [data-end-date]');
    if (countdownEl) {
      data.endDate = countdownEl.getAttribute('data-countdown-date') || countdownEl.getAttribute('data-end-date');
    }

    // ── Seller from link ──
    if (!data.sellerName) {
      const sellerLink = document.querySelector('a[href*="/user/"]');
      if (sellerLink) {
        const text = sellerLink.textContent.trim();
        if (text && text.length < 50) data.sellerName = text;
      }
    }

    // ── Images ──
    const seenImg = new Set();
    document.querySelectorAll('img[src*="media.carsandbids.com"]').forEach(img => {
      const src = img.getAttribute('src');
      if (src && !src.includes('width=80') && !src.includes('_thumb') && !src.includes('avatar')) {
        const clean = src.split('?')[0];
        if (!seenImg.has(clean)) {
          seenImg.add(clean);
          data.images.push(src);
        }
      }
    });
    // Also from srcset and background images
    document.querySelectorAll('[srcset*="media.carsandbids.com"]').forEach(el => {
      const srcset = el.getAttribute('srcset') || '';
      const urls = srcset.match(/https:\/\/media\.carsandbids\.com[^\s,]+/g);
      if (urls) urls.forEach(u => {
        const clean = u.split('?')[0];
        if (!seenImg.has(clean) && !u.includes('width=80')) {
          seenImg.add(clean);
          data.images.push(u);
        }
      });
    });
    // og:image
    const ogImg = document.querySelector('meta[property="og:image"]');
    if (ogImg) {
      const src = ogImg.getAttribute('content');
      if (src && src.includes('carsandbids') && !seenImg.has(src.split('?')[0])) {
        data.images.unshift(src);
      }
    }

    // ── Doug's Take, Highlights, Equipment from text sections ──
    const sections = document.querySelectorAll('h4, h3, .section-title');
    sections.forEach(sec => {
      const secText = sec.textContent.trim().toLowerCase();
      let content = '';
      let sibling = sec.nextElementSibling;
      while (sibling && !['H3', 'H4'].includes(sibling.tagName) && !sibling.classList?.contains('section-title')) {
        content += sibling.textContent?.trim() + '\n';
        sibling = sibling.nextElementSibling;
      }
      content = content.trim().slice(0, 8000);
      if (secText.includes("doug") && secText.includes("take")) data.dougsTake = content;
      if (secText === 'highlights' || secText.includes('highlights')) data.highlights = content;
      if (secText === 'equipment') data.equipment = content;
    });

    // ── Lot number from URL ──
    const urlMatch = window.location.pathname.match(/\/auctions\/([A-Za-z0-9]+)/);
    if (urlMatch) data.lotNumber = urlMatch[1];

    return data;
  });
}

// ─── Extract bids from page ────────────────────────────────────────

async function extractBidsFromPage(page) {
  try {
    const bidBtn = await page.$('button[data-ga="bids"], button[data-filter="4"]');
    if (bidBtn) {
      await bidBtn.click();
      await page.waitForTimeout(2000);
    }
  } catch (e) { /* bid tab may not exist */ }

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(1000);

  const bids = await page.$$eval('li.bid', (bidEls) => {
    return bidEls.map(el => {
      const userLink = el.querySelector('a.user');
      const bidValueEl = el.querySelector('dd.bid-value');
      if (!userLink || !bidValueEl) return null;
      const username = userLink.textContent?.trim() || '';
      const bidText = bidValueEl.textContent?.trim() || '';
      const amountMatch = bidText.match(/\$?([\d,]+)/);
      if (!username || !amountMatch) return null;
      const amount = parseInt(amountMatch[1].replace(/,/g, ''), 10);
      if (!amount || amount <= 0) return null;
      const href = userLink.getAttribute('href') || '';
      const profileUrl = href.startsWith('http') ? href : href ? `https://carsandbids.com${href}` : null;
      return { username, amount, profileUrl };
    }).filter(Boolean);
  });

  bids.reverse();
  return bids.map((b, i) => ({
    bidder_username: b.username,
    bid_amount: b.amount,
    bid_number: i + 1,
    profile_url: b.profileUrl,
  }));
}

// ─── URL helpers ───────────────────────────────────────────────────

function canonicalUrl(raw) {
  try {
    const u = new URL(raw);
    u.hash = ''; u.search = '';
    if (u.pathname.endsWith('/')) u.pathname = u.pathname.slice(0, -1);
    return u.toString();
  } catch { return raw.split('#')[0].split('?')[0]; }
}

function lotFromUrl(url) {
  const m = url.match(/\/auctions\/([A-Za-z0-9]+)/);
  return m ? m[1] : null;
}

// ─── Process one URL ───────────────────────────────────────────────

async function processUrl(page, url, queueItemId) {
  const canonical = canonicalUrl(url);
  const lot = lotFromUrl(url);
  console.log(`\n--- ${canonical}`);

  // Navigate
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1500);
  } catch (e) {
    console.log(`  Nav error: ${e.message?.slice(0, 60)}`);
    return { success: false, error: 'nav_error' };
  }

  // Cloudflare check
  const title = await page.title();
  if (title.includes('moment') || title.includes('Cloudflare')) {
    await page.waitForTimeout(8000);
    const t2 = await page.title();
    if (t2.includes('moment')) {
      console.log('  Cloudflare block');
      return { success: false, error: 'cloudflare' };
    }
  }

  // 404 check
  if (title.includes('404') || title.includes('Not Found')) {
    console.log('  404 not found');
    return { success: false, error: '404' };
  }

  // Scroll to load lazy content
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight / 2); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.scrollTo(0, document.body.scrollHeight); });
  await page.waitForTimeout(500);

  // Extract vehicle data
  const vd = await extractVehicleData(page);

  // Fallback: parse year/make/model from URL slug
  if (!vd.year || !vd.make) {
    const slugMatch = canonical.match(/\/(\d{4})-([a-z0-9-]+)\/?$/i);
    if (slugMatch) {
      vd.year = parseInt(slugMatch[1], 10);
      const parts = slugMatch[2].split('-');
      vd.make = parts[0].charAt(0).toUpperCase() + parts[0].slice(1);
      vd.model = parts.slice(1).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
      vd.title = `${vd.year} ${vd.make} ${vd.model}`;
    }
  }

  if (!vd.year || !vd.make) {
    console.log('  Could not extract year/make');
    return { success: false, error: 'no_identity' };
  }

  console.log(`  ${vd.year} ${vd.make} ${vd.model || '?'} | VIN: ${vd.vin || '-'} | $${vd.currentBid || '-'} | ${vd.images.length} imgs`);

  // ── Check for existing vehicle ──
  let vehicleId = null;

  // Use a single RPC call for efficient lookup
  // Try: exact URL, lowered URL, lot pattern, VIN, auction_events
  const lookupQueries = [
    supabase.from('vehicles').select('id').eq('discovery_url', canonical).limit(1).maybeSingle(),
  ];
  if (lot) {
    // Lot-based search with lowercased lot for case insensitivity
    lookupQueries.push(
      supabase.from('vehicles').select('id').ilike('discovery_url', `%/auctions/${lot.toLowerCase()}/%`).limit(1).maybeSingle()
    );
  }
  if (vd.vin) {
    lookupQueries.push(
      supabase.from('vehicles').select('id').eq('vin', vd.vin).limit(1).maybeSingle()
    );
  }
  lookupQueries.push(
    supabase.from('auction_events').select('vehicle_id').eq('source', 'cars_and_bids').ilike('source_url', `%${lot || ''}%`).limit(1).maybeSingle()
  );

  const results = await Promise.all(lookupQueries);
  for (const r of results) {
    const id = r.data?.id || r.data?.vehicle_id;
    if (id) { vehicleId = id; break; }
  }

  // ── Upsert vehicle ──
  const vehiclePayload = {
    year: vd.year,
    make: vd.make,
    model: vd.model || '',
    vin: vd.vin || undefined,
    mileage: vd.mileage || undefined,
    color: vd.exteriorColor || undefined,
    interior_color: vd.interiorColor || undefined,
    engine_type: vd.engine || undefined,
    transmission: vd.transmission || undefined,
    body_style: vd.bodyStyle || undefined,
    location: vd.location || undefined,
    sale_price: vd.auctionStatus === 'sold' ? vd.currentBid : undefined,
    high_bid: vd.auctionStatus !== 'sold' ? vd.currentBid : undefined,
    bid_count: vd.bidCount || undefined,
    discovery_url: canonical,
    discovery_source: 'carsandbids',
    listing_source: 'extract-cab-vehicles-pw',
    status: 'active',
    description: [
      vd.dougsTake ? `**Doug's Take:**\n${vd.dougsTake}` : null,
      vd.highlights ? `**Highlights:**\n${vd.highlights}` : null,
    ].filter(Boolean).join('\n\n') || undefined,
    import_metadata: {
      platform: 'carsandbids',
      dougs_take: vd.dougsTake,
      highlights: vd.highlights,
      equipment: vd.equipment,
      comment_count: vd.commentCount,
      bid_count: vd.bidCount,
      auction_status: vd.auctionStatus,
      extracted_at: new Date().toISOString(),
    },
  };

  // Remove undefined values
  Object.keys(vehiclePayload).forEach(k => {
    if (vehiclePayload[k] === undefined) delete vehiclePayload[k];
  });

  let created = false;
  if (vehicleId) {
    // Don't overwrite discovery_url/vin if they'd conflict
    const updatePayload = { ...vehiclePayload, updated_at: new Date().toISOString() };
    // Check if discovery_url would conflict
    const { data: urlOwner } = await supabase.from('vehicles').select('id').eq('discovery_url', canonical).limit(1).maybeSingle();
    if (urlOwner && urlOwner.id !== vehicleId) delete updatePayload.discovery_url;
    // Check if VIN would conflict
    if (vd.vin) {
      const { data: vinOwner } = await supabase.from('vehicles').select('id').eq('vin', vd.vin).limit(1).maybeSingle();
      if (vinOwner && vinOwner.id !== vehicleId) delete updatePayload.vin;
    }
    const { error } = await supabase.from('vehicles').update(updatePayload).eq('id', vehicleId);
    if (error) console.log(`  Vehicle update error: ${error.message?.slice(0, 60)}`);
  } else {
    const { data: ins, error } = await supabase
      .from('vehicles')
      .insert(vehiclePayload)
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.message?.includes('duplicate key')) {
        // Search aggressively: URL exact, URL lowered, lot pattern, VIN
        const searches = [
          supabase.from('vehicles').select('id').eq('discovery_url', canonical).limit(1).maybeSingle(),
          supabase.from('vehicles').select('id').ilike('discovery_url', `%${lot || canonical}%`).limit(1).maybeSingle(),
          lot ? supabase.from('vehicles').select('id').ilike('discovery_url', `%/auctions/${lot.toLowerCase()}/%`).limit(1).maybeSingle() : null,
          vd.vin ? supabase.from('vehicles').select('id').eq('vin', vd.vin).limit(1).maybeSingle() : null,
        ].filter(Boolean);
        const dupResults = await Promise.all(searches);
        let dup = null;
        for (const r of dupResults) { if (r.data?.id) { dup = r.data; break; } }

        if (dup?.id) {
          vehicleId = dup.id;
          // Remove fields that would violate unique constraints
          delete vehiclePayload.discovery_url;
          delete vehiclePayload.vin;
          await supabase.from('vehicles').update({ ...vehiclePayload, updated_at: new Date().toISOString() }).eq('id', vehicleId);
        } else {
          console.log(`  Vehicle insert dup - no match found: ${error.message?.slice(0, 60)}`);
          return { success: false, error: 'vehicle_dup_unresolved' };
        }
      } else {
        console.log(`  Vehicle insert failed: ${error.message?.slice(0, 60)}`);
        return { success: false, error: 'vehicle_insert' };
      }
    } else {
      vehicleId = ins.id;
      created = true;
    }
  }

  // ── Insert images ──
  let imagesInserted = 0;
  if (vehicleId && vd.images.length > 0) {
    // Delete old external_import images to avoid dups
    await supabase.from('vehicle_images').delete().eq('vehicle_id', vehicleId).eq('source', 'external_import');

    const imageRows = vd.images.slice(0, 50).map((imgUrl, idx) => ({
      vehicle_id: vehicleId,
      image_url: imgUrl,
      source: 'external_import',
      source_url: imgUrl,
      is_external: true,
      approval_status: 'auto_approved',
      is_approved: true,
      redaction_level: 'none',
      position: idx,
      display_order: idx,
      is_primary: idx === 0,
      exif_data: { source_url: canonical, imported_from: 'cars_and_bids' },
    }));

    const { data: imgIns, error: imgErr } = await supabase.from('vehicle_images').insert(imageRows).select('id');
    if (imgErr) {
      console.log(`  Image insert error: ${imgErr.message?.slice(0, 60)}`);
    } else {
      imagesInserted = imgIns?.length || imageRows.length;
    }
  }

  // ── Upsert external_listing ──
  if (vehicleId) {
    const listingData = {
      platform: 'cars_and_bids',
      listing_url: canonical,
      vehicle_id: vehicleId,
      current_bid: vd.currentBid || undefined,
      listing_status: vd.auctionStatus || 'active',
      end_date: vd.endDate || undefined,
      bid_count: vd.bidCount || undefined,
      metadata: {
        title: vd.title,
        seller_name: vd.sellerName,
        seller_type: vd.sellerType,
        location: vd.location,
        comment_count: vd.commentCount,
      },
    };
    Object.keys(listingData).forEach(k => { if (listingData[k] === undefined) delete listingData[k]; });

    // Unique constraint is on (vehicle_id, platform, listing_id) — use lot as listing_id
    listingData.listing_id = lot || canonical;
    const { error } = await supabase.from('external_listings').upsert(listingData, { onConflict: 'vehicle_id,platform,listing_id' });
    if (error) console.log(`  Listing upsert error: ${error.message?.slice(0, 50)}`);
  }

  // ── Upsert auction_event ──
  let auctionEventId = null;
  if (vehicleId && lot) {
    const aeData = {
      vehicle_id: vehicleId,
      source: 'cars_and_bids',
      source_url: canonical,
      lot_number: lot,
      high_bid: vd.currentBid || undefined,
      auction_end_date: vd.endDate || undefined,
      outcome: vd.auctionStatus === 'sold' ? 'sold' : vd.auctionStatus === 'reserve_not_met' ? 'reserve_not_met' : 'bid_to',
      total_bids: vd.bidCount || undefined,
      seller_name: vd.sellerName || undefined,
      seller_type: vd.sellerType || undefined,
      seller_location: vd.location || undefined,
      comments_count: vd.commentCount || undefined,
    };
    Object.keys(aeData).forEach(k => { if (aeData[k] === undefined) delete aeData[k]; });

    // Check if exists first
    const { data: existingAe } = await supabase
      .from('auction_events')
      .select('id')
      .eq('source', 'cars_and_bids')
      .eq('source_url', canonical)
      .limit(1)
      .maybeSingle();

    if (existingAe?.id) {
      auctionEventId = existingAe.id;
      const { error } = await supabase.from('auction_events').update(aeData).eq('id', auctionEventId);
      if (error) console.log(`  Auction event update error: ${error.message?.slice(0, 50)}`);
    } else {
      const { data: aeRes, error } = await supabase
        .from('auction_events')
        .insert(aeData)
        .select('id')
        .maybeSingle();
      if (error) console.log(`  Auction event insert error: ${error.message?.slice(0, 50)}`);
      else if (aeRes) auctionEventId = aeRes.id;
    }
  }

  // ── Link to C&B organization ──
  if (vehicleId) {
    const rel = vd.auctionStatus === 'sold' ? 'sold_by' : 'consigner';
    await supabase.from('organization_vehicles').upsert({
      organization_id: CAB_ORG_ID,
      vehicle_id: vehicleId,
      relationship_type: rel,
      status: 'active',
      auto_tagged: true,
      notes: `Imported from Cars & Bids: ${canonical}`,
    }, { onConflict: 'organization_id,vehicle_id,relationship_type' });
  }

  // ── Extract bids ──
  let bidsInserted = 0;
  if (vehicleId) {
    const { count: existingBids } = await supabase
      .from('external_auction_bids')
      .select('id', { count: 'exact', head: true })
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'cars_and_bids');

    if (!existingBids || existingBids < 3) {
      const bids = await extractBidsFromPage(page);
      if (bids.length > 0) {
        const auctionEndMs = vd.endDate ? new Date(vd.endDate).getTime() : Date.now();
        const bidWindowMs = 48 * 60 * 60 * 1000;
        const interval = bidWindowMs / (bids.length + 1);

        await supabase.from('external_auction_bids').delete()
          .eq('vehicle_id', vehicleId).eq('platform', 'cars_and_bids');

        const bidRows = bids.map(b => ({
          vehicle_id: vehicleId,
          platform: 'cars_and_bids',
          bid_amount: b.bid_amount,
          bid_timestamp: new Date(auctionEndMs - bidWindowMs + b.bid_number * interval).toISOString(),
          bidder_username: b.bidder_username,
          bid_number: b.bid_number,
          is_winning_bid: b.bid_number === bids.length,
          source: 'extract-cab-vehicles-pw',
          raw_data: { profile_url: b.profile_url, auction_url: canonical },
        }));

        const { error: bidErr } = await supabase.from('external_auction_bids').insert(bidRows);
        if (bidErr) console.log(`  Bid insert error: ${bidErr.message?.slice(0, 50)}`);
        else bidsInserted = bids.length;

        // Update auction_event bid_history
        if (auctionEventId) {
          await supabase.from('auction_events').update({
            bid_history: bids.map(b => ({ amount: b.bid_amount, bidder: b.bidder_username, bid_number: b.bid_number })),
          }).eq('id', auctionEventId);
        }
      }
    }
  }

  // ── Update import_queue ──
  if (queueItemId) {
    await supabase.from('import_queue').update({
      status: 'complete',
      vehicle_id: vehicleId,
      processed_at: new Date().toISOString(),
    }).eq('id', queueItemId);
  }

  const statusParts = [
    created ? 'NEW' : 'UPD',
    `${imagesInserted} imgs`,
    bidsInserted > 0 ? `${bidsInserted} bids` : null,
  ].filter(Boolean).join(' | ');
  console.log(`  ✓ ${vehicleId?.slice(0, 8)} ${statusParts}`);

  return { success: true, vehicleId, created, images: imagesInserted, bids: bidsInserted };
}

// ─── Main ──────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  let urls = []; // [{url, queueItemId?}]

  if (args.includes('--queue')) {
    const limitIdx = args.indexOf('--limit');
    const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 200;
    const offsetIdx = args.indexOf('--offset');
    const offset = offsetIdx >= 0 ? parseInt(args[offsetIdx + 1], 10) : 0;

    console.log(`Fetching ${limit} pending import_queue URLs (offset ${offset})...`);
    const { data: queueItems, error } = await supabase
      .from('import_queue')
      .select('id, listing_url')
      .eq('source_id', CAB_SOURCE_ID)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .range(offset, offset + limit - 1);

    if (error) { console.error('Queue fetch error:', error.message); process.exit(1); }
    urls = (queueItems || []).map(q => ({ url: q.listing_url, queueItemId: q.id }));
    console.log(`Got ${urls.length} URLs from import_queue`);

  } else if (args.includes('--file')) {
    const filePath = args[args.indexOf('--file') + 1];
    const lines = readFileSync(filePath, 'utf-8').split('\n').map(l => l.trim()).filter(l => l.includes('carsandbids.com'));
    urls = lines.map(u => ({ url: u }));

  } else if (args[0]?.includes('carsandbids.com')) {
    urls = [{ url: args[0] }];

  } else {
    console.log('Usage:');
    console.log('  dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs --queue --limit 500');
    console.log('  dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs --file urls.txt');
    console.log('  dotenvx run -- node scripts/extract-cab-vehicles-playwright.mjs <URL>');
    process.exit(0);
  }

  if (urls.length === 0) {
    console.log('No URLs to process');
    process.exit(0);
  }

  console.log(`Processing ${urls.length} URLs with Playwright...`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
  });
  const page = await context.newPage();

  // Block unnecessary resources for speed
  await page.route('**/*.{mp4,webm,ogg,mp3,wav}', route => route.abort());

  let stats = { processed: 0, created: 0, updated: 0, failed: 0, images: 0, bids: 0 };
  const startTime = Date.now();

  for (let i = 0; i < urls.length; i++) {
    const { url, queueItemId } = urls[i];
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    const rate = stats.processed > 0 ? (stats.processed / ((Date.now() - startTime) / 1000)).toFixed(2) : '?';
    console.log(`[${i + 1}/${urls.length}] (${elapsed}s, ${rate}/s)`);

    try {
      // Timeout per URL: 60 seconds max
      const result = await Promise.race([
        processUrl(page, url, queueItemId),
        new Promise((_, reject) => setTimeout(() => reject(new Error('URL timeout (60s)')), 60000)),
      ]);
      stats.processed++;
      if (result.success) {
        if (result.created) stats.created++; else stats.updated++;
        stats.images += result.images || 0;
        stats.bids += result.bids || 0;
      } else {
        stats.failed++;
        // Mark failed in queue
        if (queueItemId) {
          await supabase.from('import_queue').update({
            status: 'failed',
            error_message: result.error || 'extraction_failed',
            processed_at: new Date().toISOString(),
          }).eq('id', queueItemId);
        }
      }
    } catch (e) {
      console.error(`  Fatal: ${e.message?.slice(0, 80)}`);
      stats.failed++;
      stats.processed++;
      if (queueItemId) {
        await supabase.from('import_queue').update({
          status: 'failed',
          error_message: `Fatal: ${e.message?.slice(0, 200)}`,
          processed_at: new Date().toISOString(),
        }).eq('id', queueItemId);
      }
    }

    // Delay between pages (prevent rate limiting)
    await page.waitForTimeout(1000);

    // Every 100 URLs, log summary
    if ((i + 1) % 100 === 0) {
      const elapsedMin = ((Date.now() - startTime) / 60000).toFixed(1);
      console.log(`\n=== Progress: ${i + 1}/${urls.length} | ${elapsedMin}min | ${stats.created} new, ${stats.updated} upd, ${stats.failed} fail, ${stats.images} imgs, ${stats.bids} bids ===\n`);
    }
  }

  await browser.close();

  const totalTime = ((Date.now() - startTime) / 60000).toFixed(1);
  console.log(`\n════════════════════════════════════════`);
  console.log(`Done in ${totalTime} minutes`);
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Created:   ${stats.created}`);
  console.log(`  Updated:   ${stats.updated}`);
  console.log(`  Failed:    ${stats.failed}`);
  console.log(`  Images:    ${stats.images}`);
  console.log(`  Bids:      ${stats.bids}`);
  console.log(`════════════════════════════════════════`);
}

main().catch(e => { console.error(e); process.exit(1); });
