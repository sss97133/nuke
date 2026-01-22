/**
 * C&B BACKFILL LOOP
 * ==================
 * Loops through existing C&B vehicles and extracts missing data:
 * - Comments (full text, usernames, timestamps, seller/bidder tags)
 * - Images (full gallery, categorized)
 * - Content sections (Doug's Take, Equipment, Flaws, etc.)
 * - Carfax URL (for later extraction)
 *
 * PRECISE EXTRACTION TARGETS (from CAB_DOM_SELECTORS.md):
 * --------------------------------------------------------
 * COMMENTS:
 *   Container: ul.thread
 *   Each comment: ul.thread > li
 *   Username: a[title] attribute (NOT textContent!)
 *   Profile: a[title] href -> /user/USERNAME
 *   Message: .message p or .message
 *   Time: .time (relative: "42m", "2h", "3d", "1mo")
 *   Comment ID: data-id attribute
 *   System: li.system-comment (sold messages)
 *   Seller tag: look for "Seller" in li content
 *   Bidder tag: look for "Bidder" in li content
 *   Reply: starts with "Re: username"
 *
 * IMAGES:
 *   URL pattern: https://media.carsandbids.com/cdn-cgi/image/width=X,quality=70/HASH/photos/...
 *   Categories in path: /photos/exterior/, /photos/interior/, /photos/ (other)
 *   SKIP: width=80,height=80 (these are USER AVATARS, not auction images!)
 *   Full res: replace width=X with width=2080
 *
 * CONTENT SECTIONS:
 *   Doug's Take: Text after "Doug's Take" heading
 *   Highlights: Bullet points under "Highlights"
 *   Equipment: Bullet points under "Equipment"
 *   Known Flaws: Bullet points under "Known Flaws"
 *   Service History: Entries under "Recent Service History"
 *   Seller Notes: Text under "Seller Notes"
 *   Carfax URL: a.carfax or a[href*="carfax.com"]
 */

import { chromium, Page, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

// ═══════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════
const CONFIG = {
  BATCH_SIZE: 20,           // Vehicles per batch
  DELAY_BETWEEN: 2000,      // ms between vehicles
  DELAY_BETWEEN_BATCHES: 5000, // ms between batches
  MAX_VEHICLES: 100,        // Max to process (0 = all)
  START_FROM: 0,            // Offset to start from
  HEADLESS: true,           // Headless for speed
};

// ═══════════════════════════════════════════════════════════════════
// EXTRACTION SCRIPT (string-based to avoid __name issue)
// ═══════════════════════════════════════════════════════════════════
const EXTRACTION_SCRIPT = `
(function() {
  var result = {
    success: true,
    vin: null,
    currentBid: null,
    soldPrice: null,
    highBid: null,
    bidCount: null,
    commentCount: null,
    viewCount: null,
    watcherCount: null,
    timeLeft: null,
    carfaxUrl: null,
    dougsTake: null,
    highlights: [],
    equipment: [],
    modifications: [],
    knownFlaws: [],
    serviceHistory: [],
    sellerNotes: null,
    facts: {},
    comments: [],
    images: [],
    auctionResult: {
      status: null,
      sold: false,
      reserveNotMet: false,
      noSale: false
    }
  };

  try {
    var bodyText = document.body.innerText || '';

    // ═══════════════════════════════════════════════════════════════
    // BASIC DATA
    // ═══════════════════════════════════════════════════════════════

    // VIN
    var vinMatch = bodyText.match(/VIN[:\\s#]*([A-HJ-NPR-Z0-9]{17})/i);
    result.vin = vinMatch ? vinMatch[1] : null;

    // Current bid
    var bidValue = document.querySelector('.bid-value');
    if (bidValue) {
      var priceMatch = (bidValue.textContent || '').match(/\\$?([\\d,]+)/);
      result.currentBid = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
    }

    // Sold price
    var soldMatch = bodyText.match(/Sold\\s+for\\s+\\$?([\\d,]+)/i);
    result.soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;

    // Stats
    var bidsMatch = bodyText.match(/Bids\\s*(\\d+)/i);
    result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;
    var commentsMatch = bodyText.match(/Comments\\s*(\\d+)/i);
    result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
    var viewsMatch = bodyText.match(/Views\\s*([\\d,]+)/i);
    result.viewCount = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ''), 10) : null;
    var watchersMatch = bodyText.match(/Watch(?:ing|ers?)?\\s*([\\d,]+)/i);
    result.watcherCount = watchersMatch ? parseInt(watchersMatch[1].replace(/,/g, ''), 10) : null;

    // Time left
    var timeMatch = bodyText.match(/Time\\s+Left\\s*([\\d\\w\\s]+?)(?:\\n|Bid)/i);
    result.timeLeft = timeMatch ? timeMatch[1].trim() : null;

    // ═══════════════════════════════════════════════════════════════
    // AUCTION RESULT STATUS
    // ═══════════════════════════════════════════════════════════════
    if (bodyText.indexOf('Sold for') >= 0) {
      result.auctionResult.status = 'sold';
      result.auctionResult.sold = true;
      var soldMatch2 = bodyText.match(/Sold\\s+for\\s+\\$?([\\d,]+)/i);
      result.soldPrice = soldMatch2 ? parseInt(soldMatch2[1].replace(/,/g, ''), 10) : null;
    } else if (bodyText.indexOf('Bid to') >= 0 || bodyText.indexOf('Reserve Not Met') >= 0) {
      result.auctionResult.status = 'reserve_not_met';
      result.auctionResult.reserveNotMet = true;
      var bidToMatch = bodyText.match(/Bid\\s+to\\s+\\$?([\\d,]+)/i);
      result.highBid = bidToMatch ? parseInt(bidToMatch[1].replace(/,/g, ''), 10) : null;
    } else if (bodyText.indexOf('No Sale') >= 0) {
      result.auctionResult.status = 'no_sale';
      result.auctionResult.noSale = true;
    } else {
      result.auctionResult.status = 'active';
    }

    // ═══════════════════════════════════════════════════════════════
    // CARFAX URL (SUPER VALUABLE)
    // ═══════════════════════════════════════════════════════════════
    var carfaxLink = document.querySelector('a.carfax, a[href*="carfax.com"]');
    result.carfaxUrl = carfaxLink ? carfaxLink.href : null;

    // ═══════════════════════════════════════════════════════════════
    // QUICK FACTS
    // ═══════════════════════════════════════════════════════════════
    var factEls = document.querySelectorAll('.quick-facts dt, .quick-facts dd');
    for (var i = 0; i < factEls.length; i++) {
      var el = factEls[i];
      if (el.tagName === 'DT' && factEls[i + 1] && factEls[i + 1].tagName === 'DD') {
        var key = (el.textContent || '').trim().toLowerCase();
        var val = (factEls[i + 1].textContent || '').trim();
        if (key && val) result.facts[key] = val;
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // CONTENT SECTIONS (HTML-based for reliability)
    // ═══════════════════════════════════════════════════════════════
    var html = document.body.innerHTML || '';

    // Doug's Take (CRITICAL - save to Doug's profile)
    var dougMatch = bodyText.match(/Doug['']?s\\s+Take\\s*([\\s\\S]*?)(?=Highlights|Equipment|\\n[A-Z][a-z]+\\n|$)/i);
    result.dougsTake = dougMatch ? dougMatch[1].trim().substring(0, 5000) : null;

    // Helper to extract list items from HTML sections (with strict heading match)
    function extractHtmlSection(sectionName) {
      var items = [];
      // Look for h2/h3/heading with exact section name, followed by ul
      // More restrictive pattern to avoid cross-matching
      var headingPattern = new RegExp('<(?:h[23]|div)[^>]*>\\\\s*' + sectionName + '\\\\s*<\\\\/(?:h[23]|div)>[\\\\s\\\\S]*?<ul[^>]*>([\\\\s\\\\S]*?)<\\\\/ul>', 'i');
      var match = html.match(headingPattern);

      // Fallback to simpler pattern if heading pattern fails
      if (!match) {
        var simplePattern = new RegExp('>\\\\s*' + sectionName + '\\\\s*<[\\\\s\\\\S]*?<ul[^>]*>([\\\\s\\\\S]*?)<\\\\/ul>', 'i');
        match = html.match(simplePattern);
      }

      if (match) {
        var liPattern = /<li[^>]*>([\\s\\S]*?)<\\/li>/gi;
        var li;
        while ((li = liPattern.exec(match[1])) !== null && items.length < 50) {
          var text = li[1].replace(/<[^>]+>/g, '').trim();
          if (text && text.length > 2) items.push(text);
        }
      }
      return items;
    }

    // Check if section actually exists in text before extracting
    function sectionExists(name) {
      return bodyText.indexOf(name) >= 0;
    }

    // Extract with HTML method first, fallback to text
    result.highlights = extractHtmlSection('Highlights');
    result.equipment = extractHtmlSection('Equipment');
    // Only extract Modifications if section actually exists and is distinct from Equipment
    if (sectionExists('Modifications') && bodyText.indexOf('Modifications') !== bodyText.indexOf('Equipment')) {
      result.modifications = extractHtmlSection('Modifications');
    }
    result.knownFlaws = extractHtmlSection('Known Flaws');
    result.serviceHistory = extractHtmlSection('(?:Recent )?Service History');

    // Fallback text extraction if HTML didn't work
    if (result.equipment.length === 0) {
      var eqMatch = bodyText.match(/Equipment\\s*([\\s\\S]*?)(?=Modifications|Known Flaws|Video|$)/i);
      if (eqMatch) {
        var lines = eqMatch[1].split('\\n');
        for (var eq = 0; eq < lines.length && result.equipment.length < 50; eq++) {
          var line = lines[eq].trim();
          if (line && line.length > 5) result.equipment.push(line);
        }
      }
    }

    var sellerNotesMatch = bodyText.match(/Seller\\s+Notes\\s*([\\s\\S]*?)(?=Video|Other Items|$)/i);
    result.sellerNotes = sellerNotesMatch ? sellerNotesMatch[1].trim().substring(0, 2000) : null;

    // ═══════════════════════════════════════════════════════════════
    // COMMENTS (VERIFIED SELECTORS)
    // ═══════════════════════════════════════════════════════════════
    var commentEls = document.querySelectorAll('ul.thread > li');
    for (var c = 0; c < commentEls.length; c++) {
      var li = commentEls[c];
      var commentId = li.getAttribute('data-id') || '';
      var isSystem = li.classList.contains('system-comment');
      var isBidComment = li.classList.contains('bid');

      // Username from a[title] attribute (NOT textContent!)
      var userLink = li.querySelector('a[title]');
      var username = userLink ? (userLink.getAttribute('title') || '') : (isSystem ? 'SYSTEM' : 'Anonymous');
      var userHref = userLink ? (userLink.getAttribute('href') || '') : '';

      // Message text
      var messageEl = li.querySelector('.message p') || li.querySelector('.message');
      var text = messageEl ? (messageEl.textContent || '').trim() : '';

      // Time
      var timeEl = li.querySelector('.time');
      var relativeTime = timeEl ? (timeEl.textContent || '').trim() : '';

      // Tags
      var fullText = li.textContent || '';
      var isSeller = fullText.indexOf('Seller') >= 0;
      var isBidder = fullText.indexOf('Bidder') >= 0;

      // Reply pattern
      var replyMatch = text.match(/^Re:\\s*(\\w+)/i);
      var isReply = !!replyMatch;
      var replyTo = replyMatch ? replyMatch[1] : null;

      // Bid amount
      var bidAmount = null;
      if (isBidComment || fullText.toLowerCase().indexOf('bid') >= 0) {
        var bidMatch = text.match(/\\$([\\d,]+)/);
        bidAmount = bidMatch ? parseInt(bidMatch[1].replace(/,/g, ''), 10) : null;
      }

      if (text.length > 0) {
        result.comments.push({
          commentId: commentId,
          username: username,
          userHref: userHref,
          text: text.substring(0, 2000),
          relativeTime: relativeTime,
          isSystem: isSystem,
          isBid: isBidComment,
          isSeller: isSeller,
          isBidder: isBidder,
          isReply: isReply,
          replyTo: replyTo,
          bidAmount: bidAmount
        });
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // IMAGES (SKIP AVATARS!)
    // ═══════════════════════════════════════════════════════════════
    var imgEls = document.querySelectorAll('img');
    var seenUrls = {};
    for (var k = 0; k < imgEls.length; k++) {
      var img = imgEls[k];
      var src = img.src || img.getAttribute('data-src') || '';

      // Must be from C&B media
      if (src.indexOf('media.carsandbids.com') < 0) continue;

      // CRITICAL: Skip user avatars (80x80)
      if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;

      // Skip small images
      var widthMatch = src.match(/width=(\\d+)/);
      var width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      if (width < 200) continue;

      // Convert to full res
      var fullRes = src.replace(/width=\\d+/, 'width=2080').replace(/,height=\\d+/, '');

      // Skip duplicates
      if (seenUrls[fullRes]) continue;
      seenUrls[fullRes] = true;

      // Detect category from URL
      var category = 'other';
      if (src.indexOf('/photos/exterior/') >= 0) category = 'exterior';
      else if (src.indexOf('/photos/interior/') >= 0) category = 'interior';
      else if (src.indexOf('/photos/mechanical/') >= 0) category = 'mechanical';
      else if (src.indexOf('/photos/docs/') >= 0) category = 'documentation';

      result.images.push({
        url: src,
        fullResUrl: fullRes,
        category: category,
        width: width
      });
    }

  } catch (e) {
    result.success = false;
    result.error = e.message;
  }

  return result;
})()
`;

// ═══════════════════════════════════════════════════════════════════
// MAIN BACKFILL LOOP
// ═══════════════════════════════════════════════════════════════════

async function main() {
  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       C&B BACKFILL LOOP                                           ║');
  console.log('║       Extracting missing data from existing vehicles              ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  // Get vehicles that need backfill
  console.log('Fetching vehicles to backfill...\n');

  const { data: vehicles, error } = await supabase
    .from('external_listings')
    .select('id, vehicle_id, listing_url, metadata')
    .eq('platform', 'cars_and_bids')
    .order('created_at', { ascending: false })
    .range(CONFIG.START_FROM, CONFIG.START_FROM + (CONFIG.MAX_VEHICLES || 1000) - 1);

  if (error || !vehicles) {
    console.log('Error fetching vehicles:', error?.message);
    return;
  }

  console.log(`Found ${vehicles.length} C&B vehicles to process\n`);

  // Launch browser
  const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up on C&B...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);
  console.log('Session ready!\n');

  // Stats
  let processed = 0;
  let success = 0;
  let failed = 0;
  let skipped = 0;

  // Process in batches
  for (let batch = 0; batch < Math.ceil(vehicles.length / CONFIG.BATCH_SIZE); batch++) {
    const batchStart = batch * CONFIG.BATCH_SIZE;
    const batchEnd = Math.min(batchStart + CONFIG.BATCH_SIZE, vehicles.length);
    const batchVehicles = vehicles.slice(batchStart, batchEnd);

    console.log(`\n═══════════════════════════════════════════════════════════════`);
    console.log(`  BATCH ${batch + 1} (vehicles ${batchStart + 1}-${batchEnd})`);
    console.log(`═══════════════════════════════════════════════════════════════\n`);

    for (const vehicle of batchVehicles) {
      processed++;
      const url = vehicle.listing_url;

      if (!url || !url.includes('carsandbids.com')) {
        console.log(`[${processed}] SKIP Invalid URL: ${url}`);
        skipped++;
        continue;
      }

      // Extract vehicle name from URL
      const nameMatch = url.match(/\/(\d{4}-[^/]+)$/);
      const name = nameMatch ? nameMatch[1].replace(/-/g, ' ').substring(0, 40) : 'Unknown';

      process.stdout.write(`[${processed}] ${name}... `);

      try {
        // Navigate to auction
        await page.goto(url, { waitUntil: 'load', timeout: 60000 });

        // Wait for Cloudflare
        for (let i = 0; i < 15; i++) {
          const title = await page.title();
          if (!title.includes('Just a moment')) break;
          await page.waitForTimeout(1000);
        }
        await page.waitForTimeout(2000);

        // Check for 404
        const title = await page.title();
        if (title.includes('404') || title.includes('does not exist')) {
          console.log('X 404');
          failed++;
          continue;
        }

        // Load all comments using native Playwright clicks
        await page.evaluate(`document.querySelector('ul.thread')?.scrollIntoView()`);
        await page.waitForTimeout(500);

        for (let loadAttempt = 0; loadAttempt < 10; loadAttempt++) {
          try {
            const loadMoreBtn = page.locator('button:has-text("Load more comments"), a:has-text("Load more comments")').first();
            if (await loadMoreBtn.isVisible({ timeout: 1000 })) {
              await loadMoreBtn.click();
              await page.waitForTimeout(1000);
            } else {
              break;
            }
          } catch {
            break;
          }
        }

        // Extract data
        const data = await page.evaluate(EXTRACTION_SCRIPT);

        if (!data.success) {
          console.log(`X Error: ${data.error}`);
          failed++;
          continue;
        }

        // Update database
        await updateDatabase(vehicle.vehicle_id, vehicle.id, url, data);

        const status = data.auctionResult?.status || 'active';
        console.log(`OK ${data.comments.length}c ${data.images.length}i [${status}]${data.carfaxUrl ? ' +carfax' : ''}`);
        success++;

      } catch (err: any) {
        console.log(`X ${err.message.substring(0, 50)}`);
        failed++;
      }

      // Delay between vehicles
      await page.waitForTimeout(CONFIG.DELAY_BETWEEN);
    }

    // Delay between batches
    if (batch < Math.ceil(vehicles.length / CONFIG.BATCH_SIZE) - 1) {
      console.log(`\nBatch complete. Waiting ${CONFIG.DELAY_BETWEEN_BATCHES / 1000}s...`);
      await page.waitForTimeout(CONFIG.DELAY_BETWEEN_BATCHES);
    }
  }

  await browser.close();

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('  BACKFILL COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`  Processed: ${processed}`);
  console.log(`  Success: ${success}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Skipped: ${skipped}`);
}

async function updateDatabase(vehicleId: string, listingId: string, url: string, data: any) {
  // Update external_listing metadata with structured data
  const metadata = {
    source: 'cab_backfill_v3',
    extracted_at: new Date().toISOString(),
    carfax_url: data.carfaxUrl,
    dougs_take: data.dougsTake?.substring(0, 5000),
    // Structured arrays for SQL analysis
    highlights: data.highlights,
    equipment: data.equipment,
    modifications: data.modifications,
    known_flaws: data.knownFlaws,
    service_history: data.serviceHistory,
    seller_notes: data.sellerNotes,
    // Stats
    comment_count: data.comments.length,
    image_count: data.images.length,
    view_count: data.viewCount,
    watcher_count: data.watcherCount,
    // Auction result
    auction_result: data.auctionResult,
    high_bid: data.highBid,
    // Quick facts as individual fields
    ...data.facts,
  };

  // Determine listing status from auction result
  let listingStatus = 'active';
  if (data.auctionResult?.status === 'sold') listingStatus = 'sold';
  else if (data.auctionResult?.status === 'reserve_not_met') listingStatus = 'ended';
  else if (data.auctionResult?.status === 'no_sale') listingStatus = 'ended';

  await supabase
    .from('external_listings')
    .update({
      current_bid: data.soldPrice || data.highBid || data.currentBid,
      bid_count: data.bidCount,
      view_count: data.viewCount || 0,
      watcher_count: data.watcherCount || 0,
      listing_status: listingStatus,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);

  // Update vehicle VIN if found
  if (data.vin) {
    await supabase
      .from('vehicles')
      .update({ vin: data.vin, updated_at: new Date().toISOString() })
      .eq('id', vehicleId);
  }

  // Save comments
  if (data.comments.length > 0) {
    const commentRows = data.comments.map((c: any, idx: number) => ({
      vehicle_id: vehicleId,
      platform: 'cars_and_bids',
      source_url: url,
      content_hash: `cab_${listingId}_${c.commentId || idx}`,
      sequence_number: idx + 1,
      author_username: c.username,
      is_seller: c.isSeller,
      comment_type: c.isSystem ? 'system' : c.isBid ? 'bid' : c.text.includes('?') ? 'question' : 'observation',
      comment_text: c.text,
      word_count: c.text.split(/\s+/).length,
      has_question: c.text.includes('?'),
      bid_amount: c.bidAmount,
    }));

    await supabase
      .from('auction_comments')
      .upsert(commentRows, { onConflict: 'vehicle_id,content_hash' });
  }

  // Save images (with proper source to distinguish from bad batch)
  if (data.images.length > 0) {
    const imageRows = data.images.map((img: any, idx: number) => ({
      vehicle_id: vehicleId,
      image_url: img.fullResUrl,
      source_url: img.url,
      source: 'cab_backfill_v2',  // Different source to distinguish
      position: idx,
      display_order: idx,
      is_primary: idx === 0,
      is_external: true,
      is_approved: true,
      verification_status: 'approved',
      approval_status: 'auto_approved',
      exif_data: {
        source_url: url,
        imported_from: 'Cars & Bids v2',  // v2 to distinguish from bad batch
        category: img.category,
        original_width: img.width,
        extracted_at: new Date().toISOString(),
      },
    }));

    await supabase.from('vehicle_images').upsert(imageRows, {
      onConflict: 'vehicle_id,image_url',
      ignoreDuplicates: true,
    });
  }
}

main().catch(console.error);
