/**
 * Cars & Bids Extractor v2
 * Uses VERIFIED DOM selectors from CAB_DOM_SELECTORS.md
 * Properly extracts: comments, categorized images, auction data
 */

import { chromium, Page, Browser, BrowserContext } from 'playwright';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
);

const CAB_ORG_ID = '822cae29-f80e-4859-9c48-a1485a543152';

// ═══════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════

interface CABComment {
  commentId: string;
  username: string;
  userProfileUrl: string;
  userReputation: number | null;
  text: string;
  relativeTime: string;
  isSystem: boolean;
  isBid: boolean;
  isSeller: boolean;
  isBidder: boolean;
  isReply: boolean;
  replyToUsername: string | null;
  bidAmount: number | null;
}

interface CABImage {
  url: string;
  fullResUrl: string;
  category: 'exterior' | 'interior' | 'mechanical' | 'documentation' | 'other';
  width: number;
}

interface CABAuctionContent {
  dougsTake: string | null;  // CRITICAL: Save to Doug's profile
  highlights: string[];
  equipment: string[];
  knownFlaws: string[];
  recentServiceHistory: string[];
  sellerNotes: string | null;
  otherItemsIncluded: string[];
  ownershipHistory: string | null;
  carfaxUrl: string | null;  // SUPER VALUABLE
  sellerQA: { question: string; answer: string }[];
}

interface CABAuctionData {
  url: string;
  listingId: string;
  year: number;
  make: string;
  model: string;
  vin: string | null;
  mileage: number | null;
  soldPrice: number | null;
  currentBid: number | null;
  bidCount: number | null;
  commentCount: number | null;
  viewCount: number | null;
  watcherCount: number | null;
  status: string;
  reserveStatus: string | null;
  timeLeft: string | null;
  endDate: string | null;
  location: string | null;
  seller: string | null;
  sellerType: string | null;
  engine: string | null;
  transmission: string | null;
  drivetrain: string | null;
  exteriorColor: string | null;
  interiorColor: string | null;
  titleStatus: string | null;
  bodyStyle: string | null;
  content: CABAuctionContent;
  comments: CABComment[];
  images: CABImage[];
}

// ═══════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════

async function waitForCloudflare(page: Page): Promise<boolean> {
  for (let i = 0; i < 20; i++) {
    const title = await page.title();
    if (!title.includes('Just a moment') && !title.includes('Cloudflare')) {
      return true;
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

function toFullRes(url: string): string {
  // Convert any C&B image URL to full resolution (width=2080)
  return url
    .replace(/width=\d+/, 'width=2080')
    .replace(/,height=\d+/, '')
    .replace(/,fit=[^,/]+/, '');
}

function getCategoryFromUrl(url: string): CABImage['category'] {
  if (url.includes('/photos/exterior/')) return 'exterior';
  if (url.includes('/photos/interior/')) return 'interior';
  if (url.includes('/photos/mechanical/')) return 'mechanical';
  if (url.includes('/photos/docs/') || url.includes('/photos/documentation/')) return 'documentation';
  return 'other';
}

function parseRelativeTime(relTime: string): Date {
  const now = new Date();
  const text = relTime.toLowerCase().trim();

  const matches = [
    { pattern: /(\d+)mo/, unit: 30 * 24 * 60 * 60 * 1000 },
    { pattern: /(\d+)w/, unit: 7 * 24 * 60 * 60 * 1000 },
    { pattern: /(\d+)d/, unit: 24 * 60 * 60 * 1000 },
    { pattern: /(\d+)h/, unit: 60 * 60 * 1000 },
    { pattern: /(\d+)m(?!o)/, unit: 60 * 1000 },
  ];

  for (const { pattern, unit } of matches) {
    const match = text.match(pattern);
    if (match) {
      return new Date(now.getTime() - parseInt(match[1], 10) * unit);
    }
  }

  return now;
}

// ═══════════════════════════════════════════════════════════════════
// COMMENT EXTRACTION (VERIFIED SELECTORS)
// ═══════════════════════════════════════════════════════════════════

async function extractComments(page: Page): Promise<CABComment[]> {
  // Scroll to comments section
  await page.evaluate(function() {
    const comments = document.querySelector('ul.thread');
    if (comments) {
      comments.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  });
  await page.waitForTimeout(1500);

  // Click "Load more" buttons if present
  for (let i = 0; i < 10; i++) {
    const loadMore = await page.$('button:has-text("Load more"), a:has-text("more comments")');
    if (loadMore) {
      await loadMore.click();
      await page.waitForTimeout(1000);
    } else {
      break;
    }
  }

  // Extract using VERIFIED selectors from CAB_DOM_SELECTORS.md
  const comments = await page.evaluate(function() {
    const results: any[] = [];

    // VERIFIED: ul.thread > li
    document.querySelectorAll('ul.thread > li').forEach(function(li) {
      const commentId = li.getAttribute('data-id') || '';
      const isSystem = li.classList.contains('system-comment');
      const isBidClass = li.classList.contains('bid');

      // VERIFIED: Username from a[title] attribute, NOT textContent
      const userLink = li.querySelector('a[title]') as HTMLAnchorElement | null;
      const username = userLink?.getAttribute('title') || (isSystem ? 'SYSTEM' : 'Anonymous');
      const userHref = userLink?.getAttribute('href') || '';
      const userProfileUrl = userHref ? `https://carsandbids.com${userHref}` : '';

      // Extract reputation number (appears near username)
      // Pattern: username followed by number like "33", "400", "1.2k"
      const fullText = li.textContent || '';
      const repMatch = fullText.match(new RegExp(username + '\\s*([\\d.]+k?)', 'i'));
      let userReputation: number | null = null;
      if (repMatch && repMatch[1]) {
        const repText = repMatch[1].trim().toLowerCase();
        if (repText.includes('k')) {
          userReputation = Math.round(parseFloat(repText.replace('k', '')) * 1000);
        } else {
          const num = parseInt(repText, 10);
          userReputation = isNaN(num) ? null : num;
        }
      }

      // Check for Seller/Bidder tags
      const isSeller = fullText.toLowerCase().includes('seller') &&
                       li.querySelector('[class*="seller"]') !== null;
      const isBidder = fullText.toLowerCase().includes('bidder') &&
                       li.querySelector('[class*="bidder"]') !== null;

      // VERIFIED: Message from .message p or .message
      const messageEl = li.querySelector('.message p') || li.querySelector('.message');
      let text = messageEl?.textContent?.trim() || '';

      // Check for reply pattern "Re: username"
      const replyMatch = text.match(/^Re:\s*(\w+)/i);
      const isReply = !!replyMatch;
      const replyToUsername = replyMatch ? replyMatch[1] : null;

      // VERIFIED: Time from .time
      const timeEl = li.querySelector('.time');
      const relativeTime = timeEl?.textContent?.trim() || '';

      // Extract bid amount if present
      let bidAmount: number | null = null;
      const isBid = isBidClass || /\bbid\b/i.test(text);
      if (isBid) {
        const bidMatch = text.match(/\$[\d,]+/);
        if (bidMatch) {
          bidAmount = parseInt(bidMatch[0].replace(/[$,]/g, ''), 10);
        }
      }

      // Also check system comments for sold price
      if (isSystem && text.toLowerCase().includes('sold')) {
        const soldMatch = text.match(/\$[\d,]+/);
        if (soldMatch) {
          bidAmount = parseInt(soldMatch[0].replace(/[$,]/g, ''), 10);
        }
      }

      if (text.length > 0) {
        results.push({
          commentId,
          username,
          userProfileUrl,
          userReputation,
          text: text.substring(0, 5000),
          relativeTime,
          isSystem,
          isBid,
          isSeller,
          isBidder,
          isReply,
          replyToUsername,
          bidAmount,
        });
      }
    });

    return results;
  });

  return comments;
}

// ═══════════════════════════════════════════════════════════════════
// IMAGE EXTRACTION (VERIFIED SELECTORS)
// ═══════════════════════════════════════════════════════════════════

async function extractImages(page: Page): Promise<CABImage[]> {
  const images: CABImage[] = [];
  const seenUrls = new Set<string>();

  // First, collect images visible on page
  const pageImages = await page.evaluate(function() {
    const results: { url: string; width: number }[] = [];
    const imgs = document.querySelectorAll('img');

    for (let i = 0; i < imgs.length; i++) {
      const img = imgs[i];
      const src = img.src || img.getAttribute('data-src') || '';

      // MUST be from media.carsandbids.com
      if (!src.includes('media.carsandbids.com')) continue;

      // CRITICAL: Skip user avatars (80x80)
      if (src.includes('width=80') && src.includes('height=80')) continue;

      // Skip if too small (probably avatar or icon)
      const widthMatch = src.match(/width=(\d+)/);
      const width = widthMatch ? parseInt(widthMatch[1], 10) : 0;
      if (width < 200) continue;

      results.push({ url: src, width: width });
    }

    return results;
  });

  for (const img of pageImages) {
    const fullRes = toFullRes(img.url);
    if (!seenUrls.has(fullRes)) {
      seenUrls.add(fullRes);
      images.push({
        url: img.url,
        fullResUrl: fullRes,
        category: getCategoryFromUrl(img.url),
        width: img.width,
      });
    }
  }

  // Try to open gallery for more images
  try {
    // Click "View all" button
    const viewAllBtn = await page.$('button:has-text("View all"), .view-all');
    if (viewAllBtn) {
      await viewAllBtn.click();
      await page.waitForTimeout(2000);
    } else {
      // Try clicking hero image
      const heroImg = await page.$('.gallery-preview img, .hero img');
      if (heroImg) {
        await heroImg.click();
        await page.waitForTimeout(2000);
      }
    }

    // Check if PhotoSwipe gallery opened
    const pswpOpen = await page.$('.pswp--open');
    if (pswpOpen) {
      console.log('    Gallery opened, collecting images...');

      // Collect current image
      async function collectGalleryImage() {
        let src: string | null = null;
        try {
          src = await page.$eval('.pswp__img', function(img) { return img.src; });
        } catch (e) {
          src = null;
        }
        if (src && src.includes('media.carsandbids.com')) {
          const fullRes = toFullRes(src);
          if (!seenUrls.has(fullRes)) {
            seenUrls.add(fullRes);
            images.push({
              url: src,
              fullResUrl: fullRes,
              category: getCategoryFromUrl(src),
              width: 2080,
            });
          }
        }
      }

      await collectGalleryImage();

      // Navigate through gallery
      for (let i = 0; i < 200; i++) {
        const nextBtn = await page.$('.pswp__button--arrow--right');
        if (!nextBtn) break;

        await nextBtn.click();
        await page.waitForTimeout(200);
        await collectGalleryImage();

        // Check if we've cycled back to start
        const currentCount = seenUrls.size;
        if (i > 10 && currentCount === images.length) {
          break;
        }
      }

      // Close gallery
      const closeBtn = await page.$('.pswp__button--close');
      if (closeBtn) await closeBtn.click();

      console.log(`    Collected ${images.length} images from gallery`);
    }
  } catch (e) {
    // Gallery extraction failed, continue with page images
  }

  return images;
}

// ═══════════════════════════════════════════════════════════════════
// MAIN EXTRACTION
// ═══════════════════════════════════════════════════════════════════

async function extractAuction(page: Page, url: string): Promise<CABAuctionData | null> {
  try {
    await page.goto(url, { waitUntil: 'load', timeout: 60000 });

    if (!await waitForCloudflare(page)) {
      console.log('    Cloudflare challenge failed');
      return null;
    }
    await page.waitForTimeout(2000);

    const title = await page.title();
    if (title.includes('404') || title.includes('does not exist')) {
      console.log('    404 - page not found');
      return null;
    }

    // Parse URL for year/make/model
    const urlMatch = url.match(/\/auctions\/([^/]+)\/(\d{4})-([^-]+)-(.+)/);
    if (!urlMatch) {
      console.log('    Invalid URL format');
      return null;
    }
    const [, listingId, yearStr, makeRaw, modelRaw] = urlMatch;

    // Extract basic data AND content sections
    const basicData = await page.evaluate(function() {
      const result: any = {};
      const bodyText = document.body.innerText;

      // VIN
      const vinMatch = bodyText.match(/VIN[:\s#]*([A-HJ-NPR-Z0-9]{17})/i);
      result.vin = vinMatch?.[1] || null;

      // Price from .bid-value
      const bidValue = document.querySelector('.current-bid .bid-value, .bid-bar .bid-value');
      if (bidValue) {
        const priceMatch = bidValue.textContent?.match(/\$?([\d,]+)/);
        result.currentBid = priceMatch ? parseInt(priceMatch[1].replace(/,/g, ''), 10) : null;
      }

      // Check for sold price
      const soldMatch = bodyText.match(/Sold\s+for\s+\$?([\d,]+)/i);
      result.soldPrice = soldMatch ? parseInt(soldMatch[1].replace(/,/g, ''), 10) : null;

      // Bid stats
      const bidStats = document.querySelector('.bid-stats');
      if (bidStats) {
        const text = bidStats.textContent || '';
        const bidsMatch = text.match(/Bids?\s*(\d+)/i);
        result.bidCount = bidsMatch ? parseInt(bidsMatch[1], 10) : null;
        const commentsMatch = text.match(/Comments?\s*(\d+)/i);
        result.commentCount = commentsMatch ? parseInt(commentsMatch[1], 10) : null;
      }

      // Views and watchers
      const viewsMatch = bodyText.match(/Views?\s*[\n\r]*\s*([\d,]+)/i);
      result.viewCount = viewsMatch ? parseInt(viewsMatch[1].replace(/,/g, ''), 10) : null;
      const watchersMatch = bodyText.match(/Watch(?:ing|ers?)?\s*[\n\r]*\s*([\d,]+)/i);
      result.watcherCount = watchersMatch ? parseInt(watchersMatch[1].replace(/,/g, ''), 10) : null;

      // Time left and end date
      const timeLeftMatch = bodyText.match(/Time\s+Left\s*[\n\r]*\s*(\d+\s+Days?)/i);
      result.timeLeft = timeLeftMatch ? timeLeftMatch[1] : null;
      const endDateMatch = bodyText.match(/Ending\s+(\w+,\s+\w+\s+\d+\s+[\d:]+\s+[AP]M\s+\w+)/i);
      result.endDate = endDateMatch ? endDateMatch[1] : null;

      // Quick facts
      const facts: Record<string, string> = {};
      const factElements = document.querySelectorAll('.quick-facts dt, .quick-facts dd');
      for (let i = 0; i < factElements.length; i++) {
        const el = factElements[i];
        if (el.tagName === 'DT' && factElements[i + 1]?.tagName === 'DD') {
          const key = el.textContent?.trim().toLowerCase() || '';
          const val = factElements[i + 1].textContent?.trim() || '';
          if (key && val) facts[key] = val;
        }
      }

      result.mileage = facts['mileage'] ? parseInt(facts['mileage'].replace(/[^\d]/g, ''), 10) : null;
      result.engine = facts['engine'] || null;
      result.transmission = facts['transmission'] || null;
      result.drivetrain = facts['drivetrain'] || null;
      result.exteriorColor = facts['exterior color'] || facts['exterior'] || null;
      result.interiorColor = facts['interior color'] || facts['interior'] || null;
      result.titleStatus = facts['title status'] || facts['title'] || null;
      result.bodyStyle = facts['body style'] || facts['body'] || null;
      result.location = facts['location'] || null;
      result.seller = facts['seller'] || null;
      result.sellerType = facts['seller type'] || null;

      // Status
      if (bodyText.includes('Sold for')) result.status = 'sold';
      else if (bodyText.includes('Reserve Not Met')) result.status = 'reserve_not_met';
      else if (bodyText.includes('No Reserve')) result.status = 'no_reserve';
      else if (bodyText.includes('Live')) result.status = 'live';
      else result.status = 'ended';

      // Reserve
      if (bodyText.includes('No Reserve')) result.reserveStatus = 'no_reserve';
      else if (bodyText.includes('Reserve')) result.reserveStatus = 'has_reserve';
      else result.reserveStatus = null;

      // ═══════════════════════════════════════════════════════════════
      // CONTENT SECTIONS - CRITICAL
      // ═══════════════════════════════════════════════════════════════

      // CARFAX URL - SUPER VALUABLE
      const carfaxLink = document.querySelector('a.carfax, a[title*="Carfax"], a[href*="carfax.com"]') as HTMLAnchorElement | null;
      result.carfaxUrl = carfaxLink?.href || null;

      // Helper to extract section content (inline to avoid esbuild transform issues)
      function extractSection(heading: string): string[] {
        const lines: string[] = [];
        const regex = new RegExp(heading + '[\\s\\S]*?(?=\\n[A-Z][a-z]+\\n|$)', 'i');
        const match = bodyText.match(regex);
        if (match) {
          const content = match[0].replace(new RegExp('^' + heading + '\\s*', 'i'), '');
          const splitLines = content.split('\n');
          for (let i = 0; i < splitLines.length; i++) {
            const trimmed = splitLines[i].trim();
            if (trimmed && trimmed.length > 3 && !trimmed.match(/^[A-Z][a-z]+$/)) {
              lines.push(trimmed);
            }
          }
        }
        return lines.slice(0, 50); // Limit
      }

      // DOUG'S TAKE - CRITICAL: Save to Doug DeMuro's profile
      const dougsTakeMatch = bodyText.match(/Doug['']s Take\s*([\s\S]*?)(?=Highlights|Equipment|$)/i);
      result.dougsTake = dougsTakeMatch ? dougsTakeMatch[1].trim().substring(0, 5000) : null;

      // Highlights
      result.highlights = extractSection('Highlights');

      // Equipment
      result.equipment = extractSection('Equipment');

      // Known Flaws
      result.knownFlaws = extractSection('Known Flaws');

      // Recent Service History
      result.recentServiceHistory = extractSection('Recent Service History');

      // Seller Notes
      const sellerNotesMatch = bodyText.match(/Seller Notes\s*([\s\S]*?)(?=Video|Other Items|$)/i);
      result.sellerNotes = sellerNotesMatch ? sellerNotesMatch[1].trim().substring(0, 2000) : null;

      // Other Items Included
      result.otherItemsIncluded = extractSection('Other Items Included');

      // Ownership History
      const ownershipMatch = bodyText.match(/Ownership History\s*([\s\S]*?)(?=Seller Notes|Additional|$)/i);
      result.ownershipHistory = ownershipMatch ? ownershipMatch[1].trim().substring(0, 1000) : null;

      return result;
    });

    // Extract comments
    console.log('    Extracting comments...');
    const comments = await extractComments(page);
    console.log(`    Found ${comments.length} comments`);

    // Extract images
    console.log('    Extracting images...');
    const images = await extractImages(page);
    console.log(`    Found ${images.length} images`);

    return {
      url,
      listingId,
      year: parseInt(yearStr, 10),
      make: makeRaw.charAt(0).toUpperCase() + makeRaw.slice(1).toLowerCase(),
      model: modelRaw.replace(/-/g, ' '),
      vin: basicData.vin,
      mileage: basicData.mileage,
      soldPrice: basicData.soldPrice,
      currentBid: basicData.currentBid,
      bidCount: basicData.bidCount,
      commentCount: basicData.commentCount,
      viewCount: basicData.viewCount,
      watcherCount: basicData.watcherCount,
      status: basicData.status,
      reserveStatus: basicData.reserveStatus,
      timeLeft: basicData.timeLeft,
      endDate: basicData.endDate,
      location: basicData.location,
      seller: basicData.seller,
      sellerType: basicData.sellerType,
      engine: basicData.engine,
      transmission: basicData.transmission,
      drivetrain: basicData.drivetrain,
      exteriorColor: basicData.exteriorColor,
      interiorColor: basicData.interiorColor,
      titleStatus: basicData.titleStatus,
      bodyStyle: basicData.bodyStyle,
      content: {
        dougsTake: basicData.dougsTake,
        highlights: basicData.highlights || [],
        equipment: basicData.equipment || [],
        knownFlaws: basicData.knownFlaws || [],
        recentServiceHistory: basicData.recentServiceHistory || [],
        sellerNotes: basicData.sellerNotes,
        otherItemsIncluded: basicData.otherItemsIncluded || [],
        ownershipHistory: basicData.ownershipHistory,
        carfaxUrl: basicData.carfaxUrl,
        sellerQA: [], // TODO: Extract from Q&A section
      },
      comments,
      images,
    };
  } catch (error: any) {
    console.log(`    Error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// DATABASE SAVE
// ═══════════════════════════════════════════════════════════════════

async function saveToDatabase(data: CABAuctionData): Promise<string | null> {
  try {
    let vehicleId: string | null = null;

    // Find or create vehicle
    if (data.vin) {
      const { data: byVin } = await supabase
        .from('vehicles')
        .select('id')
        .eq('vin', data.vin)
        .single();
      if (byVin) vehicleId = byVin.id;
    }

    if (!vehicleId) {
      const { data: byUrl } = await supabase
        .from('vehicles')
        .select('id')
        .ilike('discovery_url', data.url)
        .single();
      if (byUrl) vehicleId = byUrl.id;
    }

    const vehicleData: any = {
      year: data.year,
      make: data.make,
      model: data.model,
      discovery_url: data.url,
      discovery_source: 'cars_and_bids',
      updated_at: new Date().toISOString(),
    };

    if (data.vin) vehicleData.vin = data.vin;
    if (data.mileage) vehicleData.mileage = data.mileage;
    if (data.location) vehicleData.location = data.location;
    if (data.exteriorColor) vehicleData.color = data.exteriorColor;
    if (data.interiorColor) vehicleData.interior_color = data.interiorColor;
    if (data.engine) vehicleData.engine_type = data.engine;
    if (data.transmission) vehicleData.transmission = data.transmission;
    if (data.drivetrain) vehicleData.drivetrain = data.drivetrain;
    if (data.bodyStyle) vehicleData.body_style = data.bodyStyle;

    if (vehicleId) {
      await supabase.from('vehicles').update(vehicleData).eq('id', vehicleId);
    } else {
      vehicleData.created_at = new Date().toISOString();
      const { data: newV, error } = await supabase
        .from('vehicles')
        .insert(vehicleData)
        .select('id')
        .single();
      if (error) throw error;
      vehicleId = newV.id;
    }

    // Save external_listing
    const listingStatus = data.status === 'sold' ? 'sold' : data.status === 'live' ? 'active' : 'ended';
    const externalListingData: any = {
      vehicle_id: vehicleId,
      organization_id: CAB_ORG_ID,
      platform: 'cars_and_bids',
      listing_url: data.url,
      listing_id: data.listingId,
      listing_status: listingStatus,
      current_bid: data.soldPrice,
      bid_count: data.bidCount,
      final_price: data.status === 'sold' ? data.soldPrice : null,
      metadata: {
        source: 'cab_extractor_v2',
        seller: data.seller,
        seller_type: data.sellerType,
        location: data.location,
        reserve_status: data.reserveStatus,
        time_left: data.timeLeft,
        end_date: data.endDate,
        view_count: data.viewCount,
        watcher_count: data.watcherCount,
        comment_count: data.commentCount,
        image_count: data.images.length,
        engine: data.engine,
        transmission: data.transmission,
        drivetrain: data.drivetrain,
        exterior_color: data.exteriorColor,
        interior_color: data.interiorColor,
        title_status: data.titleStatus,
        body_style: data.bodyStyle,
        // CRITICAL CONTENT SECTIONS
        carfax_url: data.content.carfaxUrl,
        dougs_take: data.content.dougsTake,
        highlights: data.content.highlights,
        equipment: data.content.equipment,
        known_flaws: data.content.knownFlaws,
        recent_service_history: data.content.recentServiceHistory,
        seller_notes: data.content.sellerNotes,
        other_items_included: data.content.otherItemsIncluded,
        ownership_history: data.content.ownershipHistory,
      },
      updated_at: new Date().toISOString(),
    };

    const { data: existingListing } = await supabase
      .from('external_listings')
      .select('id')
      .eq('vehicle_id', vehicleId)
      .eq('platform', 'cars_and_bids')
      .single();

    if (existingListing) {
      await supabase.from('external_listings').update(externalListingData).eq('id', existingListing.id);
    } else {
      externalListingData.created_at = new Date().toISOString();
      await supabase.from('external_listings').insert(externalListingData);
    }

    // Save comments to auction_comments
    if (data.comments.length > 0) {
      const commentRows = data.comments.map((c, idx) => ({
        vehicle_id: vehicleId,
        platform: 'cars_and_bids',
        source_url: data.url,
        content_hash: `cab_${data.listingId}_${c.commentId}`,
        sequence_number: idx + 1,
        posted_at: parseRelativeTime(c.relativeTime).toISOString(),
        author_username: c.username,
        is_seller: false,
        comment_type: c.isSystem ? 'system' : c.isBid ? 'bid' : c.text.includes('?') ? 'question' : 'observation',
        comment_text: c.text,
        word_count: c.text.split(/\s+/).length,
        has_question: c.text.includes('?'),
        bid_amount: c.bidAmount,
      }));

      await supabase
        .from('auction_comments')
        .upsert(commentRows, { onConflict: 'vehicle_id,content_hash' });

      console.log(`    Saved ${commentRows.length} comments`);
    }

    // Save images with proper categorization
    if (data.images.length > 0) {
      const imageRows = data.images.map((img, idx) => ({
        vehicle_id: vehicleId,
        image_url: img.fullResUrl,
        source_url: img.url,
        source: 'cab_extractor_v2',
        position: idx,
        display_order: idx,
        is_primary: idx === 0,
        is_external: true,
        is_approved: true,
        verification_status: 'approved',
        approval_status: 'auto_approved',
        exif_data: {
          source_url: data.url,
          imported_from: 'Cars & Bids v2',
          category: img.category,
          original_width: img.width,
        },
      }));

      // Upsert in batches
      for (let i = 0; i < imageRows.length; i += 20) {
        const batch = imageRows.slice(i, i + 20);
        await supabase.from('vehicle_images').upsert(batch, {
          onConflict: 'vehicle_id,image_url',
          ignoreDuplicates: true,
        });
      }

      console.log(`    Saved ${imageRows.length} images`);
    }

    return vehicleId;
  } catch (error: any) {
    console.log(`    DB Error: ${error.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const singleUrl = args.find(a => a.startsWith('http'));
  const startPage = parseInt(args[0] || '1', 10);
  const endPage = parseInt(args[1] || '1', 10);

  console.log('╔═══════════════════════════════════════════════════════════════════╗');
  console.log('║       CARS & BIDS EXTRACTOR v2                                    ║');
  console.log('║       With VERIFIED DOM Selectors                                 ║');
  console.log('╚═══════════════════════════════════════════════════════════════════╝\n');

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    viewport: { width: 1920, height: 1080 },
  });
  const page = await context.newPage();

  // Warm up
  console.log('Warming up session...');
  await page.goto('https://carsandbids.com', { waitUntil: 'load' });
  await waitForCloudflare(page);
  await page.waitForTimeout(3000);
  console.log('Session ready!\n');

  if (singleUrl) {
    // Single URL mode
    console.log(`Extracting: ${singleUrl}\n`);
    const data = await extractAuction(page, singleUrl);
    if (data) {
      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('  EXTRACTION RESULTS');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      console.log('BASIC DATA:');
      console.log(`  Year/Make/Model: ${data.year} ${data.make} ${data.model}`);
      console.log(`  VIN: ${data.vin || 'N/A'}`);
      console.log(`  Mileage: ${data.mileage?.toLocaleString() || 'N/A'}`);
      console.log(`  Current Bid: $${data.currentBid?.toLocaleString() || 'N/A'}`);
      console.log(`  Sold Price: $${data.soldPrice?.toLocaleString() || 'N/A'}`);
      console.log(`  Status: ${data.status} (${data.reserveStatus || 'unknown reserve'})`);
      console.log(`  Time Left: ${data.timeLeft || 'N/A'}`);
      console.log(`  End Date: ${data.endDate || 'N/A'}`);
      console.log(`  Location: ${data.location || 'N/A'}`);
      console.log(`  Seller: ${data.seller || 'N/A'} (${data.sellerType || 'N/A'})`);

      console.log('\nSPECS:');
      console.log(`  Engine: ${data.engine || 'N/A'}`);
      console.log(`  Transmission: ${data.transmission || 'N/A'}`);
      console.log(`  Drivetrain: ${data.drivetrain || 'N/A'}`);
      console.log(`  Exterior: ${data.exteriorColor || 'N/A'}`);
      console.log(`  Interior: ${data.interiorColor || 'N/A'}`);
      console.log(`  Body Style: ${data.bodyStyle || 'N/A'}`);
      console.log(`  Title: ${data.titleStatus || 'N/A'}`);

      console.log('\nSTATS:');
      console.log(`  Bids: ${data.bidCount || 0}`);
      console.log(`  Comments: ${data.comments.length} (page says ${data.commentCount})`);
      console.log(`  Views: ${data.viewCount || 'N/A'}`);
      console.log(`  Watchers: ${data.watcherCount || 'N/A'}`);
      console.log(`  Images: ${data.images.length}`);

      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('  CONTENT SECTIONS');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      console.log('CARFAX URL (SUPER VALUABLE):');
      console.log(`  ${data.content.carfaxUrl || 'NOT FOUND'}`);

      console.log('\nDOUG\'S TAKE (save to Doug\'s profile):');
      if (data.content.dougsTake) {
        console.log(`  ${data.content.dougsTake.substring(0, 300)}...`);
      } else {
        console.log('  NOT FOUND');
      }

      console.log(`\nHIGHLIGHTS (${data.content.highlights.length} items):`);
      data.content.highlights.slice(0, 3).forEach(h => console.log(`  • ${h.substring(0, 100)}`));

      console.log(`\nEQUIPMENT (${data.content.equipment.length} items):`);
      data.content.equipment.slice(0, 5).forEach(e => console.log(`  • ${e}`));

      console.log(`\nKNOWN FLAWS (${data.content.knownFlaws.length} items):`);
      data.content.knownFlaws.forEach(f => console.log(`  ⚠ ${f}`));

      console.log(`\nSERVICE HISTORY (${data.content.recentServiceHistory.length} items):`);
      data.content.recentServiceHistory.slice(0, 3).forEach(s => console.log(`  • ${s.substring(0, 80)}`));

      if (data.content.sellerNotes) {
        console.log('\nSELLER NOTES:');
        console.log(`  ${data.content.sellerNotes.substring(0, 200)}`);
      }

      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('  COMMENTS');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      data.comments.slice(0, 10).forEach(c => {
        const tags = [
          c.isSeller ? '[SELLER]' : '',
          c.isBidder ? '[BIDDER]' : '',
          c.isBid ? `[BID $${c.bidAmount?.toLocaleString()}]` : '',
          c.isSystem ? '[SYSTEM]' : '',
          c.isReply ? `[RE: ${c.replyToUsername}]` : '',
        ].filter(Boolean).join(' ');

        console.log(`  @${c.username} (rep: ${c.userReputation || '?'}) ${c.relativeTime} ${tags}`);
        console.log(`    "${c.text.substring(0, 100)}${c.text.length > 100 ? '...' : ''}"`);
        console.log('');
      });

      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('  IMAGES');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      const categories: Record<string, number> = {};
      data.images.forEach(i => {
        categories[i.category] = (categories[i.category] || 0) + 1;
      });
      console.log('By Category:');
      Object.entries(categories).forEach(([cat, count]) => {
        console.log(`  ${cat}: ${count}`);
      });
      console.log(`\nSample URLs:`);
      data.images.slice(0, 3).forEach(i => {
        console.log(`  [${i.category}] ${i.fullResUrl.substring(0, 80)}...`);
      });

      console.log('\n═══════════════════════════════════════════════════════════════════');
      console.log('  SAVING TO DATABASE');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      const vehicleId = await saveToDatabase(data);
      if (vehicleId) {
        console.log(`✅ Saved to vehicle: ${vehicleId}`);
      } else {
        console.log('❌ Failed to save');
      }
    }
  } else {
    // Batch mode - would need to implement pagination
    console.log('Batch mode not implemented in this version.');
    console.log('Usage: npx tsx scripts/cab-extractor-v2.ts <url>');
  }

  await browser.close();
  console.log('\nDone!');
}

main().catch(console.error);
