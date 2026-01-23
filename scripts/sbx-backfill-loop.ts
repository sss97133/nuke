import { chromium, type Page, type Browser } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CONFIG = {
  BATCH_SIZE: 10,
  DELAY_BETWEEN: 3000,      // 3 sec between listings
  DELAY_BETWEEN_BATCHES: 8000, // 8 sec between batches
  MAX_LISTINGS: 0,          // 0 = no limit
  HEADLESS: true,
  SKIP_IMAGE_DELETE: true,  // Skip slow delete for speed
  REPROCESS_EXISTING: true, // Re-process existing vehicles to enrich data (VIN, price, comments)
};

interface SBXListing {
  url: string;
  lotNumber: string;
  title: string;
  year: number | null;
  make: string | null;
  model: string | null;
  vin: string | null;
  mileage: number | null;
  transmission: string | null;
  currentBid: number | null;
  finalPrice: number | null;
  bidCount: number | null;
  highBidder: string | null;
  reserveMet: boolean | null;
  auctionEndDate: string | null;
  auctionStatus: string;
  images: string[];
  description: string | null;
  highlights: string[];
  location: string | null;
  sellerName: string | null;
  specialistName: string | null;
  overview: any;
  specs: any;
  exterior: any;
  interior: any;
  mechanical: any;
  condition: any;
  carfaxUrl: string | null;
  comments: SBXComment[];
}

interface SBXComment {
  commentId: number;
  authorUsername: string;
  authorUserProfileId: number;
  commentText: string;
  postedAt: string;
  parentCommentId: number | null;
  likeCount: number;
  replyCount: number;
  isSeller: boolean;
  bidAmount: number | null;
}

// ============================================================================
// DISCOVERY: Find all listing URLs from browse pages
// ============================================================================
async function discoverListings(page: Page): Promise<string[]> {
  const listings: Set<string> = new Set();

  const sections = [
    'https://sbxcars.com/auctions',
    'https://sbxcars.com/preview',
    'https://sbxcars.com/results',
  ];

  for (const sectionUrl of sections) {
    console.log(`📋 Discovering from: ${sectionUrl}`);

    try {
      await page.goto(sectionUrl, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      // Scroll to load all listings
      for (let i = 0; i < 5; i++) {
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        await page.waitForTimeout(1000);
      }

      // Extract listing URLs
      const urls = await page.evaluate(() => {
        const links = document.querySelectorAll('a[href*="/listing/"]');
        return Array.from(links).map(a => (a as HTMLAnchorElement).href);
      });

      urls.forEach(url => {
        if (url.includes('/listing/')) {
          // Normalize URL
          const clean = url.split('?')[0];
          listings.add(clean);
        }
      });

      console.log(`   Found ${urls.length} listings on this page`);
    } catch (error: any) {
      console.error(`   Error on ${sectionUrl}:`, error.message);
    }
  }

  console.log(`\n✅ Total unique listings discovered: ${listings.size}\n`);
  return Array.from(listings);
}

// ============================================================================
// SCRAPE: Extract all data from a single listing
// ============================================================================
async function scrapeListing(page: Page, url: string): Promise<SBXListing | null> {
  try {
    // Extract lot number from URL for API call
    const lotMatch = url.match(/\/listing\/(\d+)\//);
    const lotNumber = lotMatch ? lotMatch[1] : '';

    // Set up API interception for comments
    let capturedComments: SBXComment[] = [];

    const responseHandler = async (response: any) => {
      const responseUrl = response.url();
      if (responseUrl.includes('/api/v1/Comments/GetAllListingComments')) {
        try {
          const json = await response.json();
          if (json.Value && Array.isArray(json.Value)) {
            capturedComments = json.Value.map((c: any) => {
              // Extract text from Spans array
              let commentText = '';
              if (c.Text && c.Text.Spans && Array.isArray(c.Text.Spans)) {
                commentText = c.Text.Spans.map((s: any) => s.Text || '').join('').trim();
              }

              return {
                commentId: c.CommentId,
                authorUsername: c.CachedAuthorUsername || 'Anonymous',
                authorUserProfileId: c.AuthorUserProfileId,
                commentText,
                postedAt: c.CreatedAt, // Actual field name is CreatedAt
                parentCommentId: c.IsReply ? c.ParentCommentId : null,
                likeCount: c.CachedThumbsUpCount || 0,
                replyCount: c.Replies?.length || 0,
                isSeller: c.CachedAuthorIsListingOwner || false,
                bidAmount: null, // SBX doesn't include bid in comment API
              };
            });
            console.log(`   Captured ${capturedComments.length} comments from API`);
          }
        } catch (e) {
          console.log(`   Comment API error: ${e}`);
        }
      }
    };

    page.on('response', responseHandler);

    await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Trigger comments API by looking for comments section
    await page.evaluate(() => {
      // Scroll down to potentially trigger lazy loading
      window.scrollTo(0, document.body.scrollHeight / 2);
    });
    await page.waitForTimeout(1500);

    // Wait for content to load
    await page.waitForSelector('h1, .auction-title, [class*="title"]', { timeout: 10000 }).catch(() => {});

    // Use page.$eval and page.$$eval instead of page.evaluate with functions
    const title = await page.$eval('h1', el => el.textContent?.trim()).catch(() => null) ||
                  await page.title();

    // Get all images
    const images = await page.$$eval('img', imgs => {
      const results: string[] = [];
      imgs.forEach(img => {
        const src = img.src;
        if (src && (src.includes('sbxcars.com') || src.includes('i.sbxcars')) &&
            !src.includes('/Assets/') && !src.includes('.svg')) {
          results.push(src);
        }
      });
      return [...new Set(results)];
    });

    // Get page text for parsing
    const pageText = await page.evaluate('document.body.innerText');

    // Parse year/make/model from URL slug (more reliable than title)
    // URL format: /listing/609/2011-rolls-royce-phantom-drophead
    let year: number | null = null;
    let make: string | null = null;
    let model: string | null = null;

    const urlSlugMatch = url.match(/\/listing\/\d+\/(\d{4})-([^/]+)$/);
    if (urlSlugMatch) {
      year = parseInt(urlSlugMatch[1]);
      const slugParts = urlSlugMatch[2].split('-');
      // First part is make, rest is model
      if (slugParts.length >= 2) {
        make = slugParts[0].charAt(0).toUpperCase() + slugParts[0].slice(1);
        // Handle multi-word makes (e.g., "land-rover" -> "Land Rover", "mercedes-benz" -> "Mercedes-Benz")
        if (slugParts[1] === 'rover' && make.toLowerCase() === 'land') {
          make = 'Land Rover';
          model = slugParts.slice(2).join(' ');
        } else if (slugParts[1] === 'benz' && make.toLowerCase() === 'mercedes') {
          make = 'Mercedes-Benz';
          model = slugParts.slice(2).join(' ');
        } else {
          model = slugParts.slice(1).join(' ');
        }
      }
    }

    // Fallback to title parsing if URL didn't work
    if (!year || !make) {
      const titleMatch = title?.match(/^(\d{4})\s+([A-Za-z-]+)\s+(.+)$/);
      if (titleMatch) {
        year = parseInt(titleMatch[1]);
        make = titleMatch[2];
        model = titleMatch[3];
      }
    }

    // Get VIN from schema.org JSON-LD first (most reliable)
    let vin: string | null = null;
    const schemaVin = await page.evaluate(() => {
      const scripts = document.querySelectorAll('script[type="application/ld+json"]');
      for (const script of scripts) {
        try {
          const json = JSON.parse(script.textContent || '');
          if (json.vehicleIdentificationNumber) {
            return json.vehicleIdentificationNumber;
          }
          if (json['@type'] === 'Car' && json.vehicleIdentificationNumber) {
            return json.vehicleIdentificationNumber;
          }
        } catch {}
      }
      return null;
    });
    if (schemaVin) {
      vin = schemaVin;
    } else {
      // Fallback to page text
      const vinMatch = pageText.match(/VIN[:\s]*([A-HJ-NPR-Z0-9]{17})/i);
      if (vinMatch) {
        vin = vinMatch[1];
      }
    }

    // Get current bid and bidder from bid-counter-container
    let currentBid: number | null = null;
    let finalPrice: number | null = null;
    let highBidder: string | null = null;
    let bidCount: number | null = null;

    // Try to get from bid container element
    const bidContainerText = await page.$eval('.bid-counter-container, [class*="bid-counter"]',
      el => el.textContent?.trim()
    ).catch(() => null);

    if (bidContainerText) {
      // Parse "US$75,000 Current bid by: REXDEX" or similar
      const priceMatch = bidContainerText.match(/\$?([\d,]+)/);
      if (priceMatch) {
        currentBid = parseInt(priceMatch[1].replace(/,/g, ''));
      }
      const bidderMatch = bidContainerText.match(/(?:by|bidder)[:\s]*([A-Za-z0-9_]+)/i);
      if (bidderMatch) {
        highBidder = bidderMatch[1];
      }
    }

    // Get bid count from bids-count element
    const bidCountText = await page.$eval('.bids-count, [class*="bids-count"]',
      el => el.textContent?.trim()
    ).catch(() => null);

    if (bidCountText) {
      const countMatch = bidCountText.match(/(\d+)/);
      if (countMatch) {
        bidCount = parseInt(countMatch[1]);
      }
    }

    // If no price yet, try page text
    if (!currentBid) {
      const bidMatch = pageText.match(/Current\s+Bid[:\s]*\$?([\d,]+)/i) ||
                       pageText.match(/High\s+Bid[:\s]*\$?([\d,]+)/i) ||
                       pageText.match(/(?:US)?\$\s*([\d,]+)/);
      if (bidMatch) {
        currentBid = parseInt(bidMatch[1].replace(/,/g, ''));
      }
    }

    // Check for sold price - require minimum value to avoid model numbers (e.g. 911, 720)
    const soldMatch = pageText.match(/Sold\s+(?:for\s+)?(?:US)?\$\s*([\d,]+)/i);
    if (soldMatch) {
      const potentialPrice = parseInt(soldMatch[1].replace(/,/g, ''));
      // Only accept if > $1000 (avoids model numbers like 911, 720, 356)
      if (potentialPrice > 1000) {
        finalPrice = potentialPrice;
      }
    }

    // Check for AED prices and convert to approximate USD
    const aedMatch = pageText.match(/(?:AED|د\.إ)\s*([\d,]+)/i);
    if (aedMatch && !finalPrice && !currentBid) {
      const aedAmount = parseInt(aedMatch[1].replace(/,/g, ''));
      // AED to USD is roughly 0.27
      currentBid = Math.round(aedAmount * 0.27);
    }

    // Get mileage
    let mileage: number | null = null;
    const mileageMatch = pageText.match(/(?:Mileage|Odometer|Miles)[:\s]*([\d,]+)/i);
    if (mileageMatch) {
      mileage = parseInt(mileageMatch[1].replace(/,/g, ''));
    }

    // Get location
    let location: string | null = null;
    const locationMatch = pageText.match(/(?:Location|Located)[:\s]*([A-Za-z\s,]+)/i);
    if (locationMatch) {
      location = locationMatch[1].trim().substring(0, 100);
    }

    // Get description
    const description = await page.$eval('[class*="overview"], [class*="Overview"], [class*="description"]',
      el => el.textContent?.trim().substring(0, 5000)
    ).catch(() => null);

    // Get highlights
    const highlights = await page.$$eval('[class*="highlight"] li, [class*="Highlight"] li',
      els => els.map(el => el.textContent?.trim() || '').filter(t => t.length > 0)
    ).catch(() => [] as string[]);

    // Check auction status
    let auctionStatus = 'live';
    const lowerText = pageText.toLowerCase();
    if (lowerText.includes('sold')) {
      auctionStatus = 'sold';
    } else if (lowerText.includes('ended') || lowerText.includes('closed')) {
      auctionStatus = 'ended';
    } else if (lowerText.includes('upcoming') || lowerText.includes('preview')) {
      auctionStatus = 'upcoming';
    }

    // Check reserve
    const reserveMet = lowerText.includes('reserve met') ? true :
                       lowerText.includes('reserve not met') ? false : null;

    // Get Carfax URL
    const carfaxUrl = await page.$eval('a[href*="carfax.com"]', el => (el as HTMLAnchorElement).href).catch(() => null);

    // Remove response handler to prevent memory leaks
    page.removeListener('response', responseHandler);

    return {
      url,
      lotNumber,
      title: title || '',
      year,
      make,
      model,
      vin,
      mileage,
      transmission: null,
      currentBid,
      finalPrice,
      bidCount,
      highBidder,
      reserveMet,
      auctionEndDate: null,
      auctionStatus,
      images,
      description,
      highlights,
      location,
      sellerName: null,
      specialistName: null,
      overview: null,
      specs: null,
      exterior: null,
      interior: null,
      mechanical: null,
      condition: null,
      carfaxUrl,
      comments: capturedComments,
    };
  } catch (error: any) {
    console.error(`   Error scraping ${url}:`, error.message);
    return null;
  }
}

// ============================================================================
// SAVE: Upsert listing data to Supabase
// ============================================================================
async function saveListing(listing: SBXListing): Promise<{ vehicleId: string | null; isNew: boolean }> {
  // Check if we already have this listing
  const { data: existing } = await supabase
    .from('vehicles')
    .select('id')
    .eq('listing_url', listing.url)
    .maybeSingle();

  const isNew = !existing;
  let vehicleId = existing?.id;

  // Determine final price to store
  const priceToStore = listing.finalPrice || listing.currentBid;

  if (isNew) {
    // Create new vehicle
    const { data: newVehicle, error } = await supabase
      .from('vehicles')
      .insert({
        year: listing.year,
        make: listing.make,
        model: listing.model,
        vin: listing.vin,
        mileage: listing.mileage,
        listing_url: listing.url,
        description: listing.description?.substring(0, 5000),
        location: listing.location,
        high_bid: listing.currentBid,
        sold_price: listing.finalPrice,
        auction_outcome: listing.auctionStatus,
        status: 'active',
        discovery_url: listing.url,
      })
      .select('id')
      .single();

    if (error) {
      console.error('   Error creating vehicle:', error.message);
      return { vehicleId: null, isNew: false };
    }

    vehicleId = newVehicle.id;
  } else {
    // Update existing vehicle with new data
    const updateData: any = {
      auction_outcome: listing.auctionStatus,
      updated_at: new Date().toISOString(),
    };

    // Only update if we have values
    if (listing.vin) updateData.vin = listing.vin;
    if (listing.mileage) updateData.mileage = listing.mileage;
    if (listing.description) updateData.description = listing.description.substring(0, 5000);
    if (listing.location) updateData.location = listing.location;
    if (listing.currentBid) updateData.high_bid = listing.currentBid;
    if (listing.finalPrice) updateData.sold_price = listing.finalPrice;

    await supabase
      .from('vehicles')
      .update(updateData)
      .eq('id', vehicleId);
  }

  // Save to external_listings for metadata
  await supabase
    .from('external_listings')
    .upsert({
      vehicle_id: vehicleId,
      source: 'sbx_cars',
      listing_url: listing.url,
      external_id: listing.lotNumber,
      metadata: {
        title: listing.title,
        lotNumber: listing.lotNumber,
        highlights: listing.highlights,
        carfaxUrl: listing.carfaxUrl,
        reserveMet: listing.reserveMet,
        overview: listing.overview,
        specs: listing.specs,
        exterior: listing.exterior,
        interior: listing.interior,
        mechanical: listing.mechanical,
        condition: listing.condition,
      },
      updated_at: new Date().toISOString(),
    }, { onConflict: 'vehicle_id,source' });

  // Save images
  if (listing.images.length > 0 && vehicleId) {
    // Delete existing images if not skipping
    if (!CONFIG.SKIP_IMAGE_DELETE) {
      for (let delAttempt = 0; delAttempt < 20; delAttempt++) {
        const { data: existingImages } = await supabase
          .from('vehicle_images')
          .select('id')
          .eq('vehicle_id', vehicleId)
          .eq('source', 'external_import')
          .limit(20);

        if (!existingImages || existingImages.length === 0) break;

        const ids = existingImages.map(img => img.id);
        await supabase.from('vehicle_images').delete().in('id', ids);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    // Insert new images
    const imageRecords = listing.images.map((imageUrl, idx) => ({
      vehicle_id: vehicleId,
      image_url: imageUrl,
      source: 'external_import',
      display_order: idx,
    }));

    // Insert in batches
    for (let i = 0; i < imageRecords.length; i += 50) {
      const batch = imageRecords.slice(i, i + 50);
      await supabase.from('vehicle_images').insert(batch);
    }
  }

  // Save comments to auction_comments table
  if (listing.comments.length > 0 && vehicleId) {
    let commentsCreated = 0;
    let commentsSkipped = 0;

    for (const comment of listing.comments) {
      // Create content hash for deduplication
      const contentHash = Buffer.from(
        `sbx_cars-${listing.lotNumber}-${comment.commentId}`
      ).toString('base64').substring(0, 64);

      // Check if already exists
      const { data: existing } = await supabase
        .from('auction_comments')
        .select('id')
        .eq('content_hash', contentHash)
        .maybeSingle();

      if (existing) {
        commentsSkipped++;
        continue;
      }

      // Map to valid comment_type: 'bid', 'sold', or 'observation'
      const commentType = comment.bidAmount ? 'bid' : 'observation';

      const { error: commentError, data: commentData } = await supabase
        .from('auction_comments')
        .insert({
          vehicle_id: vehicleId,
          platform: 'sbx_cars',
          author_username: comment.authorUsername,
          comment_text: comment.commentText?.substring(0, 5000),
          posted_at: comment.postedAt,
          comment_type: commentType,
          is_seller: comment.isSeller,
          comment_likes: comment.likeCount,
          reply_count: comment.replyCount,
          bid_amount: comment.bidAmount,
          content_hash: contentHash,
          source_url: listing.url,
        })
        .select();

      if (commentError) {
        console.log(`   Comment insert error: ${commentError.message}`);
      } else {
        commentsCreated++;
      }
    }

    console.log(`   Comments: ${commentsCreated} created, ${commentsSkipped} skipped`);
  }

  return { vehicleId, isNew };
}

// ============================================================================
// MAIN LOOP
// ============================================================================
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  SBX CARS BACKFILL');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Config: batch=${CONFIG.BATCH_SIZE}, delay=${CONFIG.DELAY_BETWEEN}ms`);
  console.log('');

  const browser = await chromium.launch({ headless: CONFIG.HEADLESS });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // Step 1: Discover all listings
    console.log('PHASE 1: DISCOVERY');
    console.log('─────────────────────────────────────────────────────────────');
    const listingUrls = await discoverListings(page);

    if (listingUrls.length === 0) {
      console.log('No listings found. Exiting.');
      return;
    }

    // Check which listings already exist in DB
    const { data: existingUrls } = await supabase
      .from('vehicles')
      .select('listing_url')
      .in('listing_url', listingUrls.slice(0, 1000)); // Check first 1000

    const existingSet = new Set(existingUrls?.map(v => v.listing_url) || []);

    let toProcessUrls: string[];
    if (CONFIG.REPROCESS_EXISTING) {
      // Process all listings (new and existing) to enrich data
      toProcessUrls = listingUrls;
      console.log(`Processing ALL listings: ${listingUrls.length} (${existingSet.size} existing, will be enriched)`);
    } else {
      // Only process new listings
      toProcessUrls = listingUrls.filter(url => !existingSet.has(url));
      console.log(`New listings to process: ${toProcessUrls.length} (${existingSet.size} already in DB)`);
    }

    // Limit if configured
    const toProcess = CONFIG.MAX_LISTINGS > 0
      ? toProcessUrls.slice(0, CONFIG.MAX_LISTINGS)
      : toProcessUrls;

    // Step 2: Scrape and save each listing
    console.log('\nPHASE 2: EXTRACTION');
    console.log('─────────────────────────────────────────────────────────────');

    let processed = 0;
    let created = 0;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < toProcess.length; i++) {
      const url = toProcess[i];
      const batchNum = Math.floor(i / CONFIG.BATCH_SIZE) + 1;
      const inBatch = (i % CONFIG.BATCH_SIZE) + 1;

      console.log(`[${i + 1}/${toProcess.length}] Batch ${batchNum}, Item ${inBatch}`);
      console.log(`   URL: ${url}`);

      const listing = await scrapeListing(page, url);

      if (listing) {
        const { vehicleId, isNew } = await saveListing(listing);

        if (vehicleId) {
          processed++;
          if (isNew) {
            created++;
            console.log(`   ✅ Created: ${listing.year} ${listing.make} ${listing.model}`);
          } else {
            updated++;
            console.log(`   📝 Updated: ${listing.year} ${listing.make} ${listing.model}`);
          }
          const priceStr = listing.finalPrice
            ? `Sold: $${listing.finalPrice.toLocaleString()}`
            : listing.currentBid
              ? `Bid: $${listing.currentBid.toLocaleString()}`
              : 'No price';
          console.log(`   VIN: ${listing.vin || 'N/A'}, ${priceStr}, Images: ${listing.images.length}, Comments: ${listing.comments.length}`);
        } else {
          errors++;
          console.log('   ❌ Failed to save');
        }
      } else {
        errors++;
        console.log('   ❌ Failed to scrape');
      }

      // Delay
      if (i < toProcess.length - 1) {
        const isEndOfBatch = (i + 1) % CONFIG.BATCH_SIZE === 0;
        const delay = isEndOfBatch ? CONFIG.DELAY_BETWEEN_BATCHES : CONFIG.DELAY_BETWEEN;
        await new Promise(r => setTimeout(r, delay));
      }
    }

    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Total processed: ${processed}`);
    console.log(`  Created: ${created}`);
    console.log(`  Updated: ${updated}`);
    console.log(`  Errors: ${errors}`);
    console.log('═══════════════════════════════════════════════════════════════');

  } finally {
    await browser.close();
  }
}

main().catch(console.error);
