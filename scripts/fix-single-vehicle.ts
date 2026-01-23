/**
 * Fix a single vehicle - re-extract from C&B
 */

import { chromium } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const VEHICLE_ID = 'cfd289b8-b5f5-4a79-9b0e-a9298b1d442d';
const CAB_URL = 'https://carsandbids.com/auctions/9a7XbAL8/2022-porsche-911-carrera-cabriolet';

const EXTRACTION_SCRIPT = `
(function() {
  var result = {
    success: true,
    vin: null,
    currentBid: null,
    soldPrice: null,
    highBid: null,
    carfaxUrl: null,
    dougsTake: null,
    equipment: [],
    knownFlaws: [],
    serviceHistory: [],
    facts: {},
    comments: [],
    images: [],
    auctionResult: { status: null, sold: false, reserveNotMet: false }
  };

  try {
    var bodyText = document.body.innerText || '';
    var html = document.body.innerHTML || '';

    // VIN
    var vinMatch = bodyText.match(/VIN[:\\s#]*([A-HJ-NPR-Z0-9]{17})/i);
    result.vin = vinMatch ? vinMatch[1] : null;

    // Auction result
    if (bodyText.indexOf('Sold for') >= 0) {
      result.auctionResult.status = 'sold';
      result.auctionResult.sold = true;
      var soldMatch = bodyText.match(/Sold\\s+for\\s+\\$?([\\d,]+)/i);
      result.soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;
    } else if (bodyText.indexOf('Bid to') >= 0) {
      result.auctionResult.status = 'reserve_not_met';
      result.auctionResult.reserveNotMet = true;
    }

    // Carfax
    var carfaxLink = document.querySelector('a.carfax, a[href*="carfax.com"]');
    result.carfaxUrl = carfaxLink ? carfaxLink.href : null;

    // Quick facts
    var factEls = document.querySelectorAll('.quick-facts dt, .quick-facts dd');
    for (var i = 0; i < factEls.length; i++) {
      var el = factEls[i];
      if (el.tagName === 'DT' && factEls[i + 1] && factEls[i + 1].tagName === 'DD') {
        var key = (el.textContent || '').trim().toLowerCase();
        var val = (factEls[i + 1].textContent || '').trim();
        if (key && val) result.facts[key] = val;
      }
    }

    // Doug's Take
    var dougMatch = bodyText.match(/Doug['']?s\\s+Take\\s*([\\s\\S]*?)(?=Highlights|Equipment|$)/i);
    result.dougsTake = dougMatch ? dougMatch[1].trim().substring(0, 5000) : null;

    // Comments
    var commentEls = document.querySelectorAll('ul.thread > li');
    for (var c = 0; c < commentEls.length; c++) {
      var li = commentEls[c];
      var commentId = li.getAttribute('data-id') || '';
      var isSystem = li.classList.contains('system-comment');
      var isBid = li.classList.contains('bid');

      var userLink = li.querySelector('a[title]');
      var username = userLink ? (userLink.getAttribute('title') || '') : (isSystem ? 'SYSTEM' : 'Anonymous');
      var userHref = userLink ? (userLink.getAttribute('href') || '') : '';

      var messageEl = li.querySelector('.message p') || li.querySelector('.message');
      var text = messageEl ? (messageEl.textContent || '').trim() : '';

      var timeEl = li.querySelector('.time');
      var relativeTime = timeEl ? (timeEl.textContent || '').trim() : '';

      var fullText = li.textContent || '';
      var isSeller = fullText.indexOf('Seller') >= 0;

      if (text.length > 0) {
        result.comments.push({
          commentId: commentId,
          username: username,
          userHref: userHref,
          text: text.substring(0, 2000),
          relativeTime: relativeTime,
          isSystem: isSystem,
          isBid: isBid,
          isSeller: isSeller
        });
      }
    }

    // Images - SKIP AVATARS
    var imgEls = document.querySelectorAll('img');
    var seenUrls = {};
    for (var k = 0; k < imgEls.length; k++) {
      var img = imgEls[k];
      var src = img.src || img.getAttribute('data-src') || '';

      if (src.indexOf('media.carsandbids.com') < 0) continue;
      if (src.indexOf('width=80') >= 0 && src.indexOf('height=80') >= 0) continue;

      var widthMatch = src.match(/width=(\\d+)/);
      var width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      if (width < 200) continue;

      var fullRes = src.replace(/width=\\d+/, 'width=2080').replace(/,height=\\d+/, '');
      if (seenUrls[fullRes]) continue;
      seenUrls[fullRes] = true;

      var category = 'other';
      if (src.indexOf('/photos/exterior/') >= 0) category = 'exterior';
      else if (src.indexOf('/photos/interior/') >= 0) category = 'interior';

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

async function main() {
  console.log('Fixing vehicle:', VEHICLE_ID);
  console.log('URL:', CAB_URL);

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('\nWarming up...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Go to auction
  console.log('Loading auction...');
  await page.goto(CAB_URL, { waitUntil: 'load' });
  for (let i = 0; i < 15; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment')) break;
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(3000);

  // Load all comments
  console.log('Loading all comments...');
  await page.evaluate(`document.querySelector('ul.thread')?.scrollIntoView()`);
  await page.waitForTimeout(500);

  for (let i = 0; i < 10; i++) {
    try {
      const btn = page.locator('button:has-text("Load more comments")').first();
      if (await btn.isVisible({ timeout: 1000 })) {
        await btn.click();
        await page.waitForTimeout(1000);
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  // Extract
  console.log('Extracting data...');
  const data = await page.evaluate(EXTRACTION_SCRIPT);

  console.log('\n--- EXTRACTED ---');
  console.log('VIN:', data.vin);
  console.log('Sold Price:', data.soldPrice);
  console.log('Carfax:', data.carfaxUrl ? 'YES' : 'NO');
  console.log('Comments:', data.comments.length);
  console.log('Images:', data.images.length);

  if (data.comments.length > 0) {
    console.log('\nSample comments:');
    data.comments.slice(0, 3).forEach((c: any) => {
      console.log(`  @${c.username}: "${c.text.substring(0, 50)}..."`);
    });
  }

  // Save to database
  console.log('\nSaving to database...');

  // Get listing ID
  const { data: listing } = await supabase
    .from('external_listings')
    .select('id')
    .eq('vehicle_id', VEHICLE_ID)
    .single();

  if (!listing) {
    console.log('ERROR: No listing found');
    await browser.close();
    return;
  }

  // Update listing metadata
  const metadata = {
    source: 'cab_backfill_fix',
    extracted_at: new Date().toISOString(),
    carfax_url: data.carfaxUrl,
    dougs_take: data.dougsTake,
    comment_count: data.comments.length,
    image_count: data.images.length,
    auction_result: data.auctionResult,
    ...data.facts,
  };

  await supabase
    .from('external_listings')
    .update({
      current_bid: data.soldPrice,
      metadata,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listing.id);

  // Extract winner from system comment
  let winner = null;
  for (const c of data.comments) {
    if (c.isSystem && c.text.includes('Sold to')) {
      const winnerMatch = c.text.match(/Sold to (\w+)/i);
      if (winnerMatch) {
        winner = winnerMatch[1];
        console.log('Winner:', winner);
      }
    }
  }

  // Update listing with winner info
  if (winner) {
    await supabase
      .from('external_listings')
      .update({
        metadata: { ...metadata, winner_username: winner },
      })
      .eq('id', listing.id);
  }

  // Save comments
  if (data.comments.length > 0) {
    const now = new Date().toISOString();
    const commentRows = data.comments.map((c: any, idx: number) => ({
      vehicle_id: VEHICLE_ID,
      platform: 'cars_and_bids',
      source_url: CAB_URL,
      content_hash: `cab_${listing.id}_${c.commentId || idx}`,
      sequence_number: idx + 1,
      author_username: c.username,
      is_seller: c.isSeller,
      comment_type: c.isSystem ? 'sold' : c.isBid ? 'bid' : 'observation',
      comment_text: c.text,
      word_count: c.text.split(/\s+/).length,
      has_question: c.text.includes('?'),
      posted_at: now,  // Required field
    }));

    const { error: commentError } = await supabase
      .from('auction_comments')
      .upsert(commentRows, { onConflict: 'vehicle_id,content_hash' });

    if (commentError) console.log('Comment error:', commentError.message);
    else console.log('Saved', commentRows.length, 'comments');
  }

  // Save images - delete old ones first, then insert fresh
  if (data.images.length > 0) {
    // Delete any existing images for this vehicle
    await supabase
      .from('vehicle_images')
      .delete()
      .eq('vehicle_id', VEHICLE_ID);

    // Use source='external_import' to satisfy vehicle_images_attribution_check
    // Do NOT include user_id field - omitting allows constraint to pass
    const imageRows = data.images.map((img: any, idx: number) => ({
      vehicle_id: VEHICLE_ID,
      image_url: img.fullResUrl,
      source: 'external_import',  // Must be 'external_import' not 'cab_import'
      source_url: img.url,
      position: idx,
      display_order: idx,
      is_primary: idx === 0,
      is_external: true,
      is_approved: true,
      approval_status: 'auto_approved',
      redaction_level: 'none',
      exif_data: {
        source_url: CAB_URL,
        discovery_url: CAB_URL,
        imported_from: 'cars_and_bids',
      },
    }));

    const { error: imageError } = await supabase
      .from('vehicle_images')
      .insert(imageRows);

    if (imageError) console.log('Image error:', imageError.message);
    else console.log('Saved', imageRows.length, 'images');
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
